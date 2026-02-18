#!/bin/bash
# CDN Warmup Script for Jump And Say

CDN_BASE="https://cdn.maskmysheet.com"
ASSETS_DIR="public/assets"
CONCURRENT=10
TIMEOUT=30

echo "=== CDN Warmup Script ==="
echo "CDN Base: $CDN_BASE"
echo "Assets Dir: $ASSETS_DIR"
echo "Concurrent Requests: $CONCURRENT"
echo ""

# Count total files
TOTAL=$(find "$ASSETS_DIR" -type f \( -name "*.mp3" -o -name "*.ogg" -o -name "*.svg" \) | wc -l | tr -d ' ')
echo "Total files to warm up: $TOTAL"
echo ""

# Function to warm up a single URL
warmup_url() {
    local url="$1"
    local start_time=$(date +%s%3N)
    
    response=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "$url" 2>/dev/null)
    local end_time=$(date +%s%3N)
    local duration=$((end_time - start_time))
    
    if [ "$response" = "200" ]; then
        echo "✓ [$duration ms] $url"
    else
        echo "✗ [$response] $url"
    fi
}

export -f warmup_url
export CDN_BASE
export TIMEOUT

# Warm up assets/kenney files
echo "=== Warming up kenney assets ==="
find "$ASSETS_DIR" -type f \( -name "*.mp3" -o -name "*.ogg" -o -name "*.svg" \) | while read -r file; do
    # Convert file path to CDN URL
    relative_path="${file#public/}"
    url="${CDN_BASE}/${relative_path}"
    warmup_url "$url"
done

echo ""
echo "=== CDN Warmup Complete ==="
