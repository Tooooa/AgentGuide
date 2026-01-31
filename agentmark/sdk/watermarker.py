"""
Lightweight SDK wrapper for AgentMark's behavioral watermarking.

Design goals:
- Keep the public interface simple for external agents (select/decode).
- Manage internal state (bit index, round).
- Provide optional mock outputs for frontend integration.
- Expose structured payloads for logging/visualization.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Dict, List, Optional, Any
import os
import torch

from agentmark.core.watermark_sampler import (
    sample_behavior_differential,
    differential_based_decoder,
    differential_based_recombination,
    generate_contextual_key,
    DRBG,
)


DEFAULT_PAYLOAD_BITS = "11001101" * 8  # 64 bits fallback


@dataclass
class WatermarkSampleResult:
    """Structured output for a watermark sampling step."""

    action: str
    bits_embedded: int
    bit_index: int
    payload_length: int
    context_used: str
    round_num: int
    target_behaviors: List[str]
    distribution_diff: List[Dict[str, Any]]
    is_mock: bool


class AgentWatermarker:
    """
    Stateful wrapper around AgentMark's differential watermark sampler.

    Typical usage:
        wm = AgentWatermarker(payload_text="team123")
        action, meta = wm.sample(probabilities, context="task||step", history=["obs1", ...])
        decoded_bits = wm.decode(probabilities, action, context="task||step")
    """

    def __init__(
        self,
        payload_bits: Optional[str] = None,
        payload_text: Optional[str] = None,
        *,
        mock: bool = False,
        algorithm: str = "differential",
    ) -> None:
        if payload_bits and payload_text:
            raise ValueError("Specify either payload_bits or payload_text, not both.")

        if payload_bits:
            self._bit_stream = self._validate_bits(payload_bits)
        elif payload_text:
            self._bit_stream = self._text_to_bits(payload_text)
        else:
            self._bit_stream = DEFAULT_PAYLOAD_BITS

        self._bit_index = 0
        self._round_num = 0
        self.mock = mock
        self.algorithm = algorithm

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #
    def sample(
        self,
        probabilities: Dict[str, float],
        *,
        context: str = "",
        history: Optional[List[str]] = None,
        round_num: Optional[int] = None,
    ) -> WatermarkSampleResult:
        """
        Watermarked sampling.

        Args:
            probabilities: Mapping from action -> probability/score (will be normalized).
            context: Explicit context string for key generation.
            history: Optional history fallback if context is empty.
            round_num: Override internal round counter.

        Returns:
            WatermarkSampleResult
        """
        probs_norm = self._normalize_probabilities(probabilities)
        actions = list(probs_norm.keys())
        round_used = self._round_num if round_num is None else round_num

        if self.mock:
            chosen = random.choices(actions, weights=list(probs_norm.values()))[0]
            distribution_diff = self._mock_distribution_diff(probs_norm, chosen)
            return WatermarkSampleResult(
                action=chosen,
                bits_embedded=0,
                bit_index=self._bit_index,
                payload_length=len(self._bit_stream),
                context_used=context,
                round_num=round_used,
                target_behaviors=[chosen],
                distribution_diff=distribution_diff,
                is_mock=True,
            )

        # --- Real sampling via core algorithm ---
        selected_action, target_list, bits_cnt, context_used = sample_behavior_differential(
            probabilities=probs_norm,
            bit_stream=self._bit_stream,
            bit_index=self._bit_index,
            context_for_key=context or None,
            history_responses=history,
            round_num=round_used,
        )

        self._bit_index += bits_cnt
        self._round_num = round_used + 1

        distribution_diff = self._build_distribution_diff(
            probs_norm, context_used, round_used, target_list, selected_action
        )

        return WatermarkSampleResult(
            action=selected_action,
            bits_embedded=bits_cnt,
            bit_index=self._bit_index,
            payload_length=len(self._bit_stream),
            context_used=context_used,
            round_num=round_used,
            target_behaviors=target_list,
            distribution_diff=distribution_diff,
            is_mock=False,
        )

    def decode(
        self,
        probabilities: Dict[str, float],
        selected_action: str,
        *,
        context: str = "",
        history: Optional[List[str]] = None,
        round_num: Optional[int] = None,
    ) -> str:
        """
        Decode bits from a selected action given the same probabilities and context.
        """
        probs_norm = self._normalize_probabilities(probabilities)
        round_used = self._round_num if round_num is None else round_num

        return differential_based_decoder(
            probabilities=probs_norm,
            selected_behavior=selected_action,
            context_for_key=context or None,
            history_responses=history,
            round_num=round_used,
        )

    def reset(self) -> None:
        """Reset internal bit index and round counter."""
        self._bit_index = 0
        self._round_num = 0

    @property
    def current_round(self) -> int:
        return self._round_num

    @property
    def current_bit_index(self) -> int:
        return self._bit_index

    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def _validate_bits(bits: str) -> str:
        cleaned = "".join(ch for ch in bits if ch in {"0", "1"})
        if not cleaned:
            raise ValueError("payload_bits must contain at least one of '0' or '1'.")
        return cleaned

    @staticmethod
    def _text_to_bits(text: str) -> str:
        return "".join(format(ord(c), "08b") for c in text)

    @staticmethod
    def _normalize_probabilities(probs: Dict[str, float]) -> Dict[str, float]:
        if not probs:
            raise ValueError("probabilities cannot be empty.")
        total = float(sum(probs.values()))
        if total <= 0:
            raise ValueError("probabilities must sum to a positive value.")
        return {k: float(v) / total for k, v in probs.items()}

    def _mock_distribution_diff(self, probs_norm: Dict[str, float], chosen: str):
        diff = []
        for act, p in probs_norm.items():
            boosted = min(1.0, p + 0.2) if act == chosen else max(0.0, p * 0.5)
            diff.append(
                {
                    "action": act,
                    "original_prob": float(p),
                    "watermarked_prob": float(boosted),
                    "is_target_bin": act == chosen,
                    "is_selected": act == chosen,
                    "note": "mock",
                }
            )
        return diff

    def _build_distribution_diff(
        self,
        probs_norm: Dict[str, float],
        context_used: str,
        round_used: int,
        target_list: List[str],
        selected_action: str,
    ):
        """
        Reconstruct the bin selection and approximate watermarked distribution
        for visualization/logging. This mirrors the encoder's bin selection:
        - Uses the same context -> key/nonce
        - Recomputes recombination and bin choice
        - Distributes the bin mass uniformly across its members for display
        """
        behaviors = sorted(probs_norm.keys())
        probs_list = [probs_norm[b] for b in behaviors]
        device = "cpu"
        probs_tensor = torch.tensor(probs_list, dtype=torch.float32, device=device)
        indices_tensor = torch.arange(len(behaviors), device=device)

        indices_nonzero, bins, prob_new = differential_based_recombination(
            probs_tensor, indices_tensor
        )

        if prob_new.sum() == 0:
            # Degenerate case: return original distribution
            return [
                {
                    "action": b,
                    "original_prob": float(probs_norm[b]),
                    "watermarked_prob": float(probs_norm[b]),
                    "is_target_bin": True,
                    "is_selected": b == selected_action,
                }
                for b in behaviors
            ]

        prob_new = prob_new / prob_new.sum()

        key = generate_contextual_key([context_used])
        nonce = str(round_used).encode("utf-8")
        prg = DRBG(key, nonce)

        random_p = prg.generate_random(n=52)
        cdf = torch.cumsum(prob_new, dim=0)
        bin_indice_idx = torch.searchsorted(cdf, random_p).item()
        bin_indice_idx = min(bin_indice_idx, len(bins) - 1)

        selected_bin_start_index = bins[bin_indice_idx]
        bin_content_indices = indices_nonzero[selected_bin_start_index:]

        # Watermarked per-action mass for the selected bin only.
        # This reflects the conditional distribution after bin selection.
        watermarked = {b: 0.0 for b in behaviors}
        bin_mass = float(prob_new[bin_indice_idx].item())
        share = bin_mass / len(bin_content_indices) if len(bin_content_indices) > 0 else 0.0
        for idx in bin_content_indices:
            watermarked[behaviors[int(idx)]] = share

        target_set = set(target_list) if target_list else set()
        diff = []
        for b in behaviors:
            diff.append(
                {
                    "action": b,
                    "original_prob": float(probs_norm[b]),
                    "watermarked_prob": float(watermarked[b]),
                    "is_target_bin": b in target_set,
                    "is_selected": b == selected_action,
                }
            )
        return diff
