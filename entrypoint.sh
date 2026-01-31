#!/bin/bash
set -e

# Target directory for toolbench data
DATA_DIR="/app/experiments/toolbench/data/data/toolenv/tools"
CACHE_ZIP="retriever_cache.zip"
DOWNLOAD_URL="https://github.com/Tooooa/AgentMark/releases/download/v1.0.0/retriever_cache.zip"  # Replace with actual release URL if specific version needed

# Function to download data
download_data() {
    echo "[INFO] Retriever cache not found in $DATA_DIR"
    echo "[INFO] Downloading retriever_cache.zip..."
    
    # Create directory if it involves parents (though zip usually contains structure, we ensure base exists)
    mkdir -p "$DATA_DIR"
    
    # Download
    if curl -L -o "$CACHE_ZIP" "$DOWNLOAD_URL"; then
        echo "[INFO] Download complete. Unzipping..."
        # Unzip to the correct location
        # Adjusted based on typical zip structure. If zip contains 'data/toolenv...', we might need to unzip to project root.
        # Assuming zip structure is compact or matches 'retriever_cache/...', let's unzip to a temp dir to inspect or just unzip to project root experiments/toolbench/data/
        
        # Based on previous context: unzip -o retriever_cache.zip -d experiments/toolbench/data/data/toolenv/tools
        # Ideally, we unzip to experiments/toolbench/data/data/toolenv/tools if the zip IS the content of that dir.
        # Or if the zip CONTAINS that dir structure.
        # Let's follow the README instruction: unzip -o retriever_cache.zip -d experiments/toolbench/data/data/toolenv/tools
        
        unzip -o "$CACHE_ZIP" -d experiments/toolbench/data/data/toolenv/tools
        rm "$CACHE_ZIP"
        echo "[INFO] Setup complete."
    else
        echo "[ERROR] Failed to download data."
        # Don't exit error here, enable user to proceed manually or check logs
    fi
}

# Check if directory is empty or missing specific known file
if [ ! -d "$DATA_DIR" ] || [ -z "$(ls -A "$DATA_DIR")" ]; then
   # Try downloading only if we are in a mode that needs it, or just always check on startup.
   # Since it's an entrypoint, checking is cheap.
   download_data
else
    echo "[INFO] Retriever cache detected. Skipping download."
fi

# Execute the passed command
exec "$@"
