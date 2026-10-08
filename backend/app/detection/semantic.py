"""Layer 2: semantic script matching.

Each utterance is embedded and compared (cosine kNN) against a library of
scam lines tagged by tactic and a library of genuine-call lines. Close to scam
lines and far from benign ones gives the tactic a semantic score; this catches
paraphrases the keyword lexicon misses.

Backends:
  * sentence-transformers multilingual MiniLM / LaBSE (if installed)
  * a dependency-free character n-gram TF-IDF fallback, so the pipeline still
    runs on a laptop with no ML packages.
"""
from __future__ import annotations

import json
import logging
import math
import re
import zlib
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .lexicon import split_sentences

log = logging.getLogger(__name__)

TOP_K = 3
RANK_DISCOUNT = (1.0, 0.95, 0.9)

LIBRARY_PATH = Path(__file__).resolve().parents[2] / "data" / "script_library.json"


class CharNgramEmbedder:
    """Hashed character 2–4 gram TF-IDF. Script-agnostic, works for romanised and native text."""

    name = "char-ngram"
    # Similarities below lo mean "unrelated"; above hi mean "same line, reworded".
    lo, hi = 0.18, 0.55

    def __init__(self, dim: int = 1 << 15):
        self.dim = dim
        self.idf = np.ones(dim, dtype=np.float32)

    def _grams(self, text: str) -> Counter:
        text = re.sub(r"[^\w\s]", " ", text.lower())
        grams: Counter = Counter()
        for word in text.split():
            w = f" {word} "
            for n in (2, 3, 4):
                for i in range(len(w) - n + 1):
                    grams[zlib.crc32(w[i:i + n].encode()) % self.dim] += 1
        return grams

    def fit(self, corpus: list[str]) -> None:
        df = np.zeros(self.dim, dtype=np.float32)
        for doc in corpus:
            for g in self._grams(doc):
                df[g] += 1
        self.idf = np.log((1 + len(corpus)) / (1 + df)).astype(np.float32) + 1.0

    def encode(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype=np.float32)
        for i, t in enumerate(texts):
            for g, c in self._grams(t).items():
                out[i, g] = (1 + math.log(c)) * self.idf[g]
        norms = np.linalg.norm(out, axis=1, keepdims=True)
        return out / np.maximum(norms, 1e-9)


class SentenceTransformerEmbedder:
    name = "sentence-transformers"
    lo, hi = 0.40, 0.78

    def __init__(self, model_name: str):
        from sentence_transformers import SentenceTransformer  # heavy import, optional

        self.model = SentenceTransformer(model_name, device="cpu")
        self.name = f"st:{model_name.split('/')[-1]}"

    def fit(self, corpus: list[str]) -> None:
        pass

    def encode(self, texts: list[str]) -> np.ndarray:
        return np.asarray(self.model.encode(texts, normalize_embeddings=True, show_progress_bar=False), dtype=np.float32)


@dataclass
class SemanticResult:
    tactic_scores: dict[str, float] = field(default_factory=dict)
    evidence: dict[str, str] = field(default_factory=dict)
    scam_sim: float = 0.0
    benign_sim: float = 0.0
    nearest_scam: str = ""
    nearest_benign: str = ""


class SemanticMatcher:
    def __init__(self, backend: str = "auto", model_name: str = "", library_path: Path = LIBRARY_PATH):
        lib = json.loads(Path(library_path).read_text(encoding="utf-8"))
        self.scam = lib["scam"]
        self.benign = lib["benign"]
        self.embedder = self._make_embedder(backend, model_name)
        corpus = [x["text"] for x in self.scam] + [x["text"] for x in self.benign]
        self.embedder.fit(corpus)
        self.scam_vecs = self.embedder.encode([x["text"] for x in self.scam])
        self.benign_vecs = self.embedder.encode([x["text"] for x in self.benign])
        self.scam_tactics = [x["tactic"] for x in self.scam]
        log.info("L2 semantic matcher ready: %s, %d scam / %d benign lines",
                 self.embedder.name, len(self.scam), len(self.benign))

    @staticmethod
    def _make_embedder(backend: str, model_name: str):
        if backend in ("auto", "st"):
            try:
                return SentenceTransformerEmbedder(model_name or "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
            except Exception as e:  # not installed, or model download failed
                if backend == "st":
                    raise
                log.warning("sentence-transformers unavailable (%s); using char n-gram fallback", e)
        return CharNgramEmbedder()

    @property
    def backend_name(self) -> str:
        return self.embedder.name

    def _rescale(self, sim: float) -> float:
        lo, hi = self.embedder.lo, self.embedder.hi
        return float(min(1.0, max(0.0, (sim - lo) / (hi - lo))))

    def score(self, text: str) -> SemanticResult:
        res = SemanticResult()
        sents = split_sentences(text)
        if not sents:
            return res
        vecs = self.embedder.encode(sents)
        scam_sims = vecs @ self.scam_vecs.T      # (sentences, scam lines)
        benign_sims = vecs @ self.benign_vecs.T  # (sentences, benign lines)
        for si, sent in enumerate(sents):
            b_idx = int(np.argmax(benign_sims[si]))
            b_max = float(benign_sims[si, b_idx])
            s_idx = int(np.argmax(scam_sims[si]))
            s_max = float(scam_sims[si, s_idx])
            if s_max > res.scam_sim:
                res.scam_sim, res.nearest_scam = s_max, self.scam[s_idx]["text"]
            if b_max > res.benign_sim:
                res.benign_sim, res.nearest_benign = b_max, self.benign[b_idx]["text"]
            # Closer to a genuine call than to any scam line: discount heavily.
            margin_penalty = 0.3 if b_max >= s_max else 1.0
            # kNN: only the tactics of the K nearest scam lines get a score, discounted by rank.
            # (Scoring every tactic by its best line lets a weak embedding light up everything.)
            per_tactic: dict[str, float] = {}
            for rank, li in enumerate(np.argsort(-scam_sims[si])[:TOP_K]):
                tactic = self.scam_tactics[li]
                val = float(scam_sims[si, li]) * RANK_DISCOUNT[rank]
                per_tactic[tactic] = max(per_tactic.get(tactic, 0.0), val)
            for tactic, sim in per_tactic.items():
                s = self._rescale(sim) * margin_penalty
                if s > res.tactic_scores.get(tactic, 0.0):
                    res.tactic_scores[tactic] = s
                    res.evidence[tactic] = sent
        return res

    def benign_strength(self, res: SemanticResult) -> float:
        """0..1: how much this utterance reads like a genuine call rather than a scam."""
        if res.benign_sim <= res.scam_sim:
            return 0.0
        return self._rescale(res.benign_sim) * min(1.0, (res.benign_sim - res.scam_sim) * 5)
