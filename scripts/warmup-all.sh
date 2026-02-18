#!/bin/bash
# Complete CDN Warmup Script

CDN_BASE="https://cdn.maskmysheet.com"

warm_file() {
    local path="$1"
    local url="${CDN_BASE}/assets/${path}"
    local code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$url" 2>/dev/null)
    
    if [ "$code" = "200" ]; then
        echo "✓ $path"
        echo "success" >> /tmp/warmup_stats
    else
        echo "✗ [$code] $path"
        echo "fail" >> /tmp/warmup_stats
    fi
}

export -f warm_file
export CDN_BASE

rm -f /tmp/warmup_stats

echo "=== Warming all assets (parallel) ==="
echo "Started at: $(date)"
echo ""

cd /Users/liushuai/github/jump_and_say/public/assets
find . -type f \( -name "*.mp3" -o -name "*.ogg" -o -name "*.svg" \) | \
    sed 's|^\./||' | \
    xargs -P20 -I{} bash -c 'warm_file "$@"' _ {} 

echo ""
echo "=== Summary ==="
SUCCESS=$(grep -c "success" /tmp/warmup_stats 2>/dev/null || echo 0)
FAILED=$(grep -c "fail" /tmp/warmup_stats 2>/dev/null || echo 0)
echo "Success: $SUCCESS"
echo "Failed: $FAILED"
echo "Completed at: $(date)"
rm -f /tmp/warmup_stats
