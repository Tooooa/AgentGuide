"""
Watermark Sampler Module
Responsibility: Contains all algorithms related to behavior sampling
"""

import random
import math
import torch
import hmac
import hashlib
import numpy as np
import os


# ==============================================================================
# ================ Contextual Key Generation ================
# ==============================================================================

def generate_contextual_key(history_responses, num_bytes=32):
    """
    Generate a deterministic key based on history responses (context).
    
    Args:
        history_responses (list): A list of past behavior description strings.
        num_bytes (int): Number of bytes for the generated key (default 32, corresponding to SHA-256).

    Returns:
        bytes: The generated key.
        
    Example:
        >>> history = ["User liked the video", "User collected the video"]
        >>> key = generate_contextual_key(history)
        >>> len(key)
        32
    """
    if not history_responses:
        # Cold start: If history is empty, use a fixed initial string
        context_string = "INITIAL_CONTEXT_FOR_AGENT_WATERMARK"
    else:
        # Use simple strategy: use the most recent response as context
        # Here we use the last response, can be extended to concatenation of multiple responses
        context_string = history_responses[-1]
        
    # Use SHA-256 hash function to convert context string to a fixed-length key
    hasher = hashlib.sha256()
    hasher.update(context_string.encode('utf-8'))
    return hasher.digest()[:num_bytes]


# ==============================================================================
# ================ Differential Scheme Watermark Engine ================
# ==============================================================================

# Pseudo-Random Generator (PRG/DRBG), ensuring sender and receiver can synchronize random processes
class DRBG:
    def __init__(self, key, nonce):
        self.key = key
        self.nonce = nonce
        self.counter = 0

    def generate_random_bits(self, n):
        message = self.nonce + self.counter.to_bytes(4, 'big')
        hmac_sha512 = hmac.new(self.key, message, hashlib.sha512).digest()
        self.counter += 1
        
        bits = ''.join(format(byte, '08b') for byte in hmac_sha512)
        return bits[:n]

    def generate_random(self, n):
        # Generate a floating point number in (0,1) from bit string
        random_bits = self.generate_random_bits(n)
        random_int = int(random_bits, 2)
        random_float = random_int / (2**n)
        return random_float

# Uniform cyclic shift encoder (selects an item within the selected "bin" based on secret info)
# Standard version - Consistent with Artifacts implementation
def uni_cyclic_shift_enc(bit_stream, n, PRG, precision=52):
    """
    Cyclic shift uniform steganography encoder (Artifacts standard version)
    
    Args:
        bit_stream (str): Bit stream to embed
        n (int): Bin size
        PRG: Pseudo-random generator
        precision (int): Precision parameter
        
    Returns:
        tuple: (selected index, embedded bit string)
    """
    if n == 1:
        PRG.generate_random(n=precision)
        return 0, ''
    
    ptr = PRG.generate_random(n=precision)
    R = math.floor(ptr * n)
    
    k = math.floor(math.log2(n))
    t = n - 2**k
    
    # Check if bit stream is sufficient
    if len(bit_stream) < k:
        # Insufficient bit stream, select randomly but consume PRG to maintain synchronization
        return R, ''
    
    bits = bit_stream[:k]
    
    # Check if an extra bit is needed
    if len(bit_stream) < k + 1:
        bits_res = '0'  # Default value
    else:
        bits_res = bit_stream[k]
    
    idx_sort = lsb_bits2int([int(b) for b in bits])
    
    if idx_sort < 2**k - t:
        return (idx_sort + R) % n, bits
    else:
        return (2 * (idx_sort - (2**k - t)) + (2**k - t) + R + int(bits_res)) % n, bits + bits_res

# Differential recombination module (Core innovation: horizontal slicing)
# V2: Use stable sort to handle equal probabilities
def differential_based_recombination(prob, indices):
    bins = []
    
    # ========================== Use Stable Sort ==========================
    # torch.argsort returns an index tensor that sorts the input tensor.
    # stable=True ensures that when values in prob are equal, the corresponding indices maintain their original order.
    # This is key to guaranteeing encoding/decoding synchronization!
    # [FIX] Round probabilities to avoid floating point noise changing the order of "equal" values
    prob_rounded = torch.round(prob * 1e8) / 1e8
    sorted_order_indices = torch.argsort(prob_rounded, stable=True, descending=False)
    
    # Use this deterministic order to rearrange prob and indices
    prob = prob[sorted_order_indices]
    indices = indices[sorted_order_indices]
    # ==================================================================

    mask = prob > 0
    prob_nonzero = prob[mask]
    indices_nonzero = indices[mask]
 
    diff = torch.cat((prob_nonzero[:1], torch.diff(prob_nonzero, n=1)))
    n = len(prob_nonzero)

    weights = torch.arange(n, 0, -1, device = prob.device) 
    diff_positive = diff > 0

    prob_new = diff[diff_positive] * weights[diff_positive] 
    bins = torch.arange(n, device = prob.device)[diff_positive]

    return indices_nonzero, bins, prob_new

# Differential Encoder (Engine Assembly)
def differential_based_encoder(prob, indices, bit_stream, bit_index, PRG, precision = 52, **kwargs):
    indices_nonzero, bins, prob_new = differential_based_recombination(prob, indices)
    if prob_new.sum() == 0: # Avoid division by zero
        # If all probabilities are equal, select one randomly
        random_idx = int(PRG.generate_random(precision) * len(indices))
        return indices[random_idx].view(1,1), 0

    prob_new = prob_new/prob_new.sum()

    random_p = PRG.generate_random(n = precision)
    cdf = torch.cumsum(prob_new, dim=0)
    bin_indice_idx = torch.searchsorted(cdf, random_p).item()
    
    selected_bin_start_index = bins[bin_indice_idx]
    bin_content = indices_nonzero[selected_bin_start_index:]

    idx, bits = uni_cyclic_shift_enc(bit_stream=bit_stream[bit_index:], n = len(bin_content), PRG = PRG, precision=precision)
    
    num = len(bits)
    prev = bin_content[idx].view(1,1)

    return prev, num


# ==============================================================================
# ================ Basic Sampling Algorithms ================
# ==============================================================================

def sample_behavior(probabilities, seed=None, round_num=0, strategy="weighted", temperature=1.0):
    """
    Select a behavior from the list based on probabilities (No Watermark Version)
    
    Args:
        probabilities (dict): Dictionary of behaviors and their corresponding probabilities
        seed (int, optional): Random seed to ensure reproducibility
        round_num (int, optional): Current round number to introduce variation based on fixed seed
        strategy (str): Sampling strategy, options:
            - "weighted": Weighted random sampling (original probability distribution)
            - "greedy": Greedy selection (select the one with highest probability)
            - "temperature": Temperature sampling (adjust probability distribution using temperature parameter)
        temperature (float): Temperature parameter, only used when strategy="temperature"
            - temperature < 1.0: More inclined towards high probability actions
            - temperature = 1.0: Equivalent to weighted sampling
            - temperature > 1.0: More uniform distribution
        
    Returns:
        str: Selected behavior
        
    Example:
        >>> probs = {"Like": 0.3, "Collect": 0.2, "Repost": 0.5}
        >>> sample_behavior(probs, seed=42, round_num=1, strategy="greedy")
        'Repost'  # Always selects the one with highest probability
    """
    # Set random seed
    if seed is not None:
        combined_seed = seed + round_num
        random.seed(combined_seed)
    
    # Get behavior list and corresponding probability list
    behaviors = list(probabilities.keys())
    probs = list(probabilities.values())
    
    # Ensure probabilities sum to 1
    total = sum(probs)
    if total != 1.0:
        probs = [p/total for p in probs]
    
    if strategy == "greedy":
        # Greedy strategy: Select the action with highest probability (similar to official ALFWorld eval mode)
        max_idx = probs.index(max(probs))
        selected_behavior = behaviors[max_idx]
    
    elif strategy == "temperature":
        # Temperature sampling: Adjust the "sharpness" of the probability distribution
        # Lower temperature means more inclination towards high probability actions
        if temperature <= 0:
            raise ValueError("Temperature must be positive")
        
        # Apply temperature scaling
        scaled_probs = [p ** (1.0 / temperature) for p in probs]
        total_scaled = sum(scaled_probs)
        scaled_probs = [p / total_scaled for p in scaled_probs]
        
        # Use scaled probabilities for weighted sampling
        selected_behavior = random.choices(behaviors, weights=scaled_probs, k=1)[0]
    
    else:  # "weighted" or default
        # Weighted random sampling: Sample according to original probability distribution
        selected_behavior = random.choices(behaviors, weights=probs, k=1)[0]
    
    return selected_behavior


# ==============================================================================
# ================ Traditional Watermark Sampling Algorithms ================
# ==============================================================================

def sample_behavior_watermark(probabilities, seed=None, round_num=0, prob_bias=0.5, ratio=0.5, BEHAVIOR_TYPES=[]):
    """
    Randomly select a behavior from list based on probabilities, adding probability bias to some behaviors (Old Probability Bias Watermark)
    
    Args:
        probabilities (dict): Dictionary of behaviors and their corresponding probabilities
        seed (int, optional): Random seed to ensure reproducibility
        round_num (int, optional): Current round number to introduce variation based on fixed seed
        prob_bias (float, optional): Probability bias to adjust probability
        ratio (float, optional): Proportion of behaviors to bias, 0-1, controls how many BEHAVIOR_TYPES get prob_bias added
        BEHAVIOR_TYPES (list, optional): List of behavior types

    Returns:
        tuple: (Selected behavior, List of behaviors with added probability bias)
        
    Example:
        >>> probs = {"Like": 0.3, "Collect": 0.2, "Repost": 0.5}
        >>> behavior, biased_list = sample_behavior_watermark(probs, seed=42, round_num=1, prob_bias=0.5, ratio=0.5, BEHAVIOR_TYPES=['Like', 'Collect', 'Repost'])
        >>> print(f"Selected: {behavior}, Biased: {biased_list}")
    """
    # Number of behaviors
    behavior_num = len(BEHAVIOR_TYPES)
    
    # Set random seed
    if seed is not None:
        # Combine seed and round number to create new seed
        combined_seed = seed + round_num
        random.seed(combined_seed)
    
    # Partition behaviors needing bias based on combined_seed and ratio
    # Calculate count of behaviors to bias
    biased_count = int(behavior_num * ratio)
    # Randomly select behaviors to bias
    add_logits_behavior_list = random.sample(BEHAVIOR_TYPES, biased_count)
    
    # Get behavior list and corresponding probability list
    behaviors = list(probabilities.keys())
    probs = list(probabilities.values())
    
    # Add probability bias to selected behaviors
    modified_probs = []
    for behavior, prob in zip(behaviors, probs):
        if behavior in add_logits_behavior_list:
            modified_probs.append(prob + prob_bias)
        else:
            modified_probs.append(prob)
    
    # Ensure probabilities sum to 1
    total = sum(modified_probs)
    if total != 1.0:
        modified_probs = [p/total for p in modified_probs]
    
    # Use random.choices for weighted random selection
    selected_behavior_watermark = random.choices(behaviors, weights=modified_probs, k=1)[0]
    
    return selected_behavior_watermark, add_logits_behavior_list


def sample_behavior_watermark_uncertainty(probabilities, seed=None, round_num=0, prob_bias=0.5, ratio=0.5, BEHAVIOR_TYPES=[], uncertainty_threshold=0.5):
    """
    Randomly select a behavior based on probabilities, adding bias to some behaviors, and evaluate behavior uncertainty.
    
    Args:
        probabilities (dict): Dictionary of behaviors and their corresponding probabilities
        seed (int, optional): Random seed to ensure reproducibility
        round_num (int, optional): Current round number to introduce variation based on fixed seed
        prob_bias (float, optional): Probability bias to adjust probability
        ratio (float, optional): Proportion of behaviors to bias, 0-1, controls how many BEHAVIOR_TYPES get prob_bias added
        BEHAVIOR_TYPES (list, optional): List of behavior types
        uncertainty_threshold (float, optional): Uncertainty threshold, behaviors above this are considered unstable

    Returns:
        tuple: (Selected behavior, List of behaviors with added probability bias, Whether watermark is applied, Uncertainty score)
        
    Example:
        >>> probs = {"Like": 0.3, "Collect": 0.2, "Repost": 0.5}
        >>> behavior, biased_list, is_stable, unc = sample_behavior_watermark_uncertainty(
        ...     probs, seed=42, round_num=1, prob_bias=0.5, ratio=0.5,
        ...     BEHAVIOR_TYPES=['Like', 'Collect', 'Repost'], uncertainty_threshold=0.5
        ... )
        >>> print(f"Selected: {behavior}, Biased: {biased_list}, Stable: {is_stable}, Uncertainty: {unc}")
    """
    # Number of behaviors
    behavior_num = len(BEHAVIOR_TYPES)
    
    # Set random seed
    if seed is not None:
        # Combine seed and round number to create new seed
        combined_seed = seed + round_num
        random.seed(combined_seed)
    
    # Partition behaviors needing bias based on combined_seed and ratio
    # Calculate count of behaviors to bias
    biased_count = int(behavior_num * ratio)
    # Randomly select behaviors to bias
    add_logits_behavior_list = random.sample(BEHAVIOR_TYPES, biased_count)
    
    # Get behavior list and corresponding probability list
    behaviors = list(probabilities.keys())
    probs = list(probabilities.values())
    
    # Record original probabilities for later comparison
    original_probs = probs.copy()
    
    # Add probability bias to selected behaviors
    modified_probs = []
    for behavior, prob in zip(behaviors, probs):
        if behavior in add_logits_behavior_list:
            modified_probs.append(prob + prob_bias)
        else:
            modified_probs.append(prob)
    
    # Ensure probabilities sum to 1
    total = sum(modified_probs)
    if total != 1.0:
        modified_probs = [p/total for p in modified_probs]
    
    # Use random.choices for weighted random selection
    selected_behavior_watermark = random.choices(behaviors, weights=modified_probs, k=1)[0]
    
    # Calculate uncertainty
    # NOTE Method 1: Calculate difference between top 1 and top 2 modified probabilities
    # Sorting probabilities, difference between 1st and 2nd indicates confidence. Larger difference implies less uncertainty.
    # E.g., if max prob 0.8, 2nd 0.1, diff 0.7, selection is confident.
    sorted_probs = sorted(modified_probs, reverse=True)
    max_prob_diff = sorted_probs[0] - sorted_probs[1]
    
    # NOTE Method 2: Calculate max change between original and modified probabilities
    # Larger change implies watermark has larger impact, thus higher uncertainty.
    # E.g., original 0.2, modified 0.7, change 0.5, impact is high.
    prob_changes = [abs(m - o) for m, o in zip(modified_probs, original_probs)]
    max_prob_change = max(prob_changes)
    
    # NOTE Method 3: Calculate Entropy
    # Higher entropy means flatter distribution, higher uncertainty.
    # E.g., uniform [0.33, 0.33, 0.34], entropy ~1, very uncertain.
    # Concentrated [0.9, 0.05, 0.05], entropy ~0, very certain.
    entropy = -sum(p * math.log2(p) if p > 0 else 0 for p in modified_probs)
    normalized_entropy = entropy / math.log2(len(behaviors))  # Normalized entropy
    
    # Comprehensive uncertainty metric (can be adjusted as needed)
    uncertainty = (
        (1 - max_prob_diff) +  # Smaller prob diff means higher uncertainty
        max_prob_change +      # Larger prob change means higher uncertainty
        normalized_entropy     # Higher entropy means higher uncertainty
    ) / 3
    
    # Determine if watermark should be applied. Lower uncertainty means higher stability, more likely to start watermarking.
    is_stable = uncertainty < uncertainty_threshold
    
    return selected_behavior_watermark, add_logits_behavior_list, is_stable, uncertainty


# ==============================================================================
# ================ Differential Watermark Sampling ================
# ==============================================================================

def sample_behavior_differential(probabilities, bit_stream, bit_index, context_for_key=None, history_responses=None, seed=None, round_num=0):
    """
    Select behavior using the Differential Scheme Engine and embed secret information (New Differential Watermark Scheme)
    Adapter function for the new engine, supports dynamic key generation based on context.

    Args:
        probabilities (dict): Dictionary of behaviors and their corresponding probabilities.
        bit_stream (str): Secret information bit stream to embed.
        bit_index (int): Starting index in the bit stream.
        context_for_key (str, optional): Explicit context string for key generation (Recommended).
        history_responses (list, optional): [Deprecated] List of history responses, used only when context_for_key is None.
        seed (int, optional): Random seed (Fallback, current implementation uses context key).
        round_num (int, optional): Current round number.

    Returns:
        tuple: (Selected behavior, Target behavior list for detection, Number of bits embedded, Actual context used for key)
        
    Example:
        >>> probs = {"Like": 0.3, "Collect": 0.2, "Repost": 0.5}
        >>> context = "response1||response2"
        >>> behavior, targets, bits, ctx = sample_behavior_differential(probs, "10110", 0, context_for_key=context, round_num=1)
        >>> print(f"Selected: {behavior}, Targets: {targets}, Bits: {bits}")
    """
    # --- 1. Data Format Conversion (Adapt input for new engine) ---
    # Ensure fixed behavior order for consistent indexing
    behaviors = sorted(probabilities.keys())
    probs_list = [probabilities[b] for b in behaviors]
    
    # Convert to PyTorch Tensors
    # Force CPU to avoid CUDA initialization overhead in massive parallel runs
    device = 'cpu'
    probs_tensor = torch.tensor(probs_list, dtype=torch.float32, device=device)
    indices_tensor = torch.arange(len(behaviors), device=device)
    
    # --- 2. Initialize PRG (Dynamic Key Gen based on Context) ---
    # Decide context: Prefer context_for_key, else build from history_responses
    if context_for_key is not None:
        # Use explicit context string
        context_used = context_for_key
    else:
        # Backward compatibility: Build context from history_responses
        if history_responses is None:
            history_responses = []
        # Use sliding window (recent 3 responses) to build context
        window_size = 3
        recent_responses = history_responses[-window_size:] if len(history_responses) > 0 else []
        context_used = "||".join(recent_responses) if recent_responses else ""
    
    # === New Method: Key based on Explicit Context String ===
    key = generate_contextual_key([context_used])  # Pass as list for compatibility
    # nonce uses round number to ensure different random sequence per round
    nonce = str(round_num).encode('utf-8') 
    
    # === Old Method: Static Key based on Pre-shared Seed (Kept as comment) ===
    # If fallback to static key needed, uncomment below:
    # if seed is None:
    #     seed = 42
    # combined_seed_str = str(seed)
    # round_num_str = str(round_num)
    # key = combined_seed_str.encode('utf-8')
    # nonce = round_num_str.encode('utf-8')
    
    PRG = DRBG(key, nonce)

    # --- 3. Call New Engine Core ---
    selected_idx_tensor, num_bits_embedded = differential_based_encoder(
        prob=probs_tensor,
        indices=indices_tensor,
        bit_stream=bit_stream,
        bit_index=bit_index,
        PRG=PRG
    )
    selected_idx = selected_idx_tensor.item()
    
    # --- 4. Convert Output and Generate "Target List" for Detection ---
    # Convert selected index ID back to behavior string
    selected_behavior = behaviors[selected_idx]
    
    # For detector (detect_watermark.py) to work, we need to recalculate which "bin" was selected.
    # Detector needs to know what the "target range" is.
    PRG_for_detection = DRBG(key, nonce)  # Recreate PRG with same params
    
    indices_nonzero, bins, prob_new = differential_based_recombination(probs_tensor, indices_tensor)
    prob_new = prob_new / prob_new.sum()
    
    random_p = PRG_for_detection.generate_random(n=52)
    cdf = torch.cumsum(prob_new, dim=0)
    bin_indice_idx = torch.searchsorted(cdf, random_p).item()

    selected_bin_start_index = bins[bin_indice_idx]
    bin_content_indices = indices_nonzero[selected_bin_start_index:]
    
    # This is equivalent to "Green List" in old engine
    target_behavior_list = [behaviors[i] for i in bin_content_indices]

    if os.getenv("AGENTMARK_DEBUG_SAMPLER"):
        debug_payload = {
            "stage": "bin_select",
            "random_p": float(random_p),
            "cdf": [float(x) for x in cdf.tolist()],
            "bin_indice_idx": int(bin_indice_idx),
            "selected_bin_start_index": int(selected_bin_start_index),
            "bin_content": target_behavior_list,
        }
        print(f"[agentmark:sampler] {json.dumps(debug_payload, ensure_ascii=True)}")
    
    return selected_behavior, target_behavior_list, num_bits_embedded, context_used


# ==============================================================================
# ================ Differential Watermark Decoder ================
# ==============================================================================

def lsb_bits2int(bits):
    """
    Convert bit list to integer (LSB first)
    
    Args:
        bits (list): List of bits, e.g., [1, 0, 1] means binary 101 (LSB first)
        
    Returns:
        int: Corresponding integer value
        
    Example:
        >>> lsb_bits2int([1, 0, 1])  # LSB: 1*1 + 0*2 + 1*4 = 5
        5
    """
    result = 0
    for i, bit in enumerate(bits):
        result += bit * (2 ** i)
    return result


def lsb_int2bits(num, length):
    """
    Convert integer to bit list (LSB first)
    
    Args:
        num (int): Integer to convert
        length (int): Length of bit list
        
    Returns:
        list: List of bits (LSB first)
        
    Example:
        >>> lsb_int2bits(5, 3)  # 5 = 101(binary) -> [1, 0, 1] (LSB first)
        [1, 0, 1]
    """
    bits = []
    for _ in range(length):
        bits.append(num % 2)
        num //= 2
    return bits


def uni_cyclic_shift_dec(idx, n, PRG, precision=52):
    """
    Uniform cyclic shift decoder (Artifacts standard version)
    Corresponds to encoder uni_cyclic_shift_enc, extracts secret bits from selected index.
    
    Must optionally consistent with encoder PRG call order!
    
    Args:
        idx (int): Selected index position (relative position in the bin)
        n (int): Bin size
        PRG: Pseudo-random generator
        precision (int): Precision parameter
        
    Returns:
        str: Extracted bit string
    """
    if n == 1:
        PRG.generate_random(n=precision)
        return ''
    
    # Must be same as encoder, generate R first
    ptr = PRG.generate_random(n=precision)
    R = math.floor(ptr * n)
    
    k = math.floor(math.log2(n))
    t = n - 2**k
    
    # Reverse cyclic shift
    idx_sort = (idx - R) % n
    
    if idx_sort < 2**k - t:
        bits = lsb_int2bits(idx_sort, k)
        bits = "".join([str(_) for _ in bits])
        return bits
    else:
        s1 = idx_sort - 2**k + t
        s_last = s1 % 2
        
        bits = lsb_int2bits((s1 - s_last) // 2 + 2**k - t, k)
        bits = "".join([str(_) for _ in bits])
        
        if s_last == 0:
            return bits + '0'
        else:
            return bits + '1'


def differential_based_decoder(probabilities, selected_behavior, context_for_key=None, history_responses=None, round_num=0):
    """
    Differential Watermark Decoder - Extract embedded secret bits from selected behavior
    
    Args:
        probabilities (dict): Dictionary of behaviors and their corresponding probabilities
        selected_behavior (str): Actually selected behavior
        context_for_key (str, optional): Explicit context string used for key generation (Recommended to read from log)
        history_responses (list, optional): [Deprecated] List of history responses, used only when context_for_key is None
        round_num (int): Current round number (Must be same as encoding)
        
    Returns:
        str: Extracted bit string
        
    Example:
        >>> probs = {"Like": 0.3, "Collect": 0.2, "Repost": 0.5}
        >>> context = "response1||response2"
        >>> bits = differential_based_decoder(probs, "Repost", context_for_key=context, round_num=1)
        >>> print(f"Extracted bits: {bits}")
    """
    # --- 1. Data Format Conversion ---
    behaviors = sorted(probabilities.keys())
    probs_list = [probabilities[b] for b in behaviors]
    
    # Convert to PyTorch Tensors
    # Force CPU to avoid CUDA initialization overhead in massive parallel runs
    device = 'cpu'
    probs_tensor = torch.tensor(probs_list, dtype=torch.float32, device=device)
    indices_tensor = torch.arange(len(behaviors), device=device)
    
    # Find index of selected behavior
    try:
        selected_idx = behaviors.index(selected_behavior)
    except ValueError:
        print(f"Warning: Selected behavior '{selected_behavior}' not in behavior list")
        return ''
    
    prev_tensor = torch.tensor([selected_idx], device=device)
    
    # --- 2. Initialize PRG (Must be exactly same as encoding) ---
    # Decide context: Prefer context_for_key
    if context_for_key is not None:
        context_used = context_for_key
    else:
        # Backward compatibility: Build from history_responses
        if history_responses is None:
            history_responses = []
        window_size = 3
        recent_responses = history_responses[-window_size:] if len(history_responses) > 0 else []
        context_used = "||".join(recent_responses) if recent_responses else ""
    
    key = generate_contextual_key([context_used])
    nonce = str(round_num).encode('utf-8')
    PRG = DRBG(key, nonce)
    
    # --- 3. Probability Recombination (Same as encoder) ---
    indices_nonzero, bins, prob_new = differential_based_recombination(probs_tensor, indices_tensor)
    
    if prob_new.sum() == 0:
        return ''
    
    prob_new = prob_new / prob_new.sum()
    
    # --- 4. Bin Sampling (Same as encoder) ---
    random_p = PRG.generate_random(n=52)
    cdf = torch.cumsum(prob_new, dim=0)
    bin_indice_idx = torch.searchsorted(cdf, random_p).item()
    
    selected_bin_start_index = bins[bin_indice_idx]
    bin_content = indices_nonzero[selected_bin_start_index:]
    
    # --- 5. Uniform Steganography Decoding ---
    # Find position of selected index in the bin
    try:
        idx_in_bin = (bin_content == prev_tensor.item()).nonzero().item()
    except (RuntimeError, ValueError):
        # If selected behavior not in bin, something went wrong
        print(f"Warning: Selected behavior not in expected bin, cannot decode")
        return ''
    
    # Use cyclic shift decoder to extract bits
    bits = uni_cyclic_shift_dec(idx=idx_in_bin, n=len(bin_content), PRG=PRG, precision=52)
    
    return bits
# ==============================================================================
# ================ Red-Green List Sampling Algorithms ================
# ==============================================================================

def sample_behavior_red_green(probabilities, context_for_key=None, history_responses=None, seed=None, round_num=0, gamma=0.5, delta=2.0):
    """
    Use Red-Green List strategy (KGW Style) for behavior sampling.
    
    Args:
        probabilities (dict): Behavior and their raw probabilities.
        context_for_key (str): Context info, used to generate random seed.
        history_responses (list): Backup context.
        seed (int): Backup seed.
        round_num (int): Round number, introducing time variance.
        gamma (float): Green list ratio (0.0 - 1.0). E.g., 0.5 means half behaviors are green list.
        delta (float): Logit bias value. Green list behaviors' logits will increase by delta.
        
    Returns:
        tuple: (Selected behavior, Green list, 0 bits, context_used)
    """
    # 1. Prepare Data
    behaviors = sorted(probabilities.keys())
    probs_list = [probabilities[b] for b in behaviors]
    # Force CPU to avoid CUDA initialization overhead in massive parallel runs
    device = 'cpu'
    
    # Convert probabilities to Logits (Inverse Softmax is not unique, assume raw Logits is log(p))
    # Add a small value to avoid log(0)
    epsilon = 1e-9
    probs_tensor = torch.tensor(probs_list, dtype=torch.float32, device=device)
    logits = torch.log(probs_tensor + epsilon)
    
    # 2. Generate Random Seed (Hash Context)
    if context_for_key is not None:
        context_used = context_for_key
    else:
        window_size = 3
        recent_responses = history_responses[-window_size:] if history_responses else []
        context_used = "||".join(recent_responses)
        
    # Generate hash as pseudo-random source
    # Note: To make red-green list independent for each behavior, typically hash(context + behavior)
    # But for efficiency and convenience of list return, here we generate a context-based random vector
    
    key = generate_contextual_key([context_used])
    nonce = str(round_num).encode('utf-8')
    PRG = DRBG(key, nonce)
    
    # 3. Partition Red-Green List
    # Generate a random number in [0, 1] for each behavior
    # To ensure behavior order irrelevance, strictly should use hash(context + behavior_name)
    # But as long as behaviors list sort order is fixed, using PRG sequence is also deterministic and efficient
    
    green_list = []
    
    # Generate len(behaviors) random numbers
    random_vals = [PRG.generate_random(32) for _ in range(len(behaviors))]
    
    mask = torch.zeros_like(logits, device=device)
    
    for i, r_val in enumerate(random_vals):
        if r_val < gamma:
            # Enter Green List
            green_list.append(behaviors[i])
            mask[i] = 1.0
            
    # 4. Apply Watermark (Logit Bias)
    # Green List Logits increase by delta
    watermarked_logits = logits + (mask * delta)
    
    # 5. Sampling
    # Normalize using Softmax
    watermarked_probs = torch.softmax(watermarked_logits, dim=0)
    
    # Convert to Python list for weighted random
    final_probs = watermarked_probs.tolist()
    
    # Sampling
    # To maintain determinism, we can continue using PRG or use externally provided global seed
    # To match AgentMark style, use random.choices (depends on global seed or loop seed)
    # But considering sample_behavior_differential uses PRG efficiently, ideally PRG here too
    
    # Use next random number from PRG for sampling (Inverse Transform Sampling)
    rand_p = PRG.generate_random(52)
    cdf = torch.cumsum(watermarked_probs, dim=0)
    idx = torch.searchsorted(cdf, rand_p).item()
    idx = min(idx, len(behaviors) - 1) # Boundary protection
    
    selected_behavior = behaviors[idx]
    
    return selected_behavior, green_list, 0, context_used
