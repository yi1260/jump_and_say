#!/usr/bin/env bash
set -euo pipefail

# CDN预热失败重试脚本
# 使用方法: ./warmup-retry.sh [失败日志文件]
# 默认读取 warmup_fail.log

FAIL_LOG="${1:-warmup_fail.log}"
CONCURRENCY=20

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

if [ ! -f "$FAIL_LOG" ]; then
    echo -e "${RED}错误: 找不到失败日志文件 $FAIL_LOG${NC}"
    exit 1
fi

if [ ! -s "$FAIL_LOG" ]; then
    echo -e "${GREEN}失败日志为空，没有需要重试的文件${NC}"
    exit 0
fi

echo -e "${BLUE}==========================================${NC}"
echo -e "${BLUE}CDN预热失败重试${NC}"
echo -e "${BLUE}==========================================${NC}"
echo "失败日志: $FAIL_LOG"

# 统计失败数量
FAIL_COUNT=$(wc -l < "$FAIL_LOG" | tr -d ' ')
echo "失败数量: $FAIL_COUNT"
echo "并发数: $CONCURRENCY"
echo ""

# --- FIFO queue ---
FIFO="$(mktemp -u)"
mkfifo "$FIFO"
exec 3<>"$FIFO"
rm -f "$FIFO"

NEW_FAIL_LOG="warmup_fail_$(date +%Y%m%d_%H%M%S).log"
: > "$NEW_FAIL_LOG"

worker() {
  while IFS= read -r line <&3; do
    [[ -z "$line" ]] && continue
    
    # 解析失败日志行格式: [FAIL] CODE URL
    url=$(echo "$line" | awk '{print $3}')
    
    # 重试请求
    code=$(curl -sS --retry 3 --retry-delay 1 --connect-timeout 15 -m 90 \
      -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || true)
    
    [[ -z "$code" ]] && code="000"

    if [[ "$code" == "200" || "$code" == "206" || "$code" == "304" ]]; then
      echo -e "${GREEN}✓${NC} $url"
    else
      echo -e "${RED}✗ [$code]${NC} $url"
      printf "%s\n" "$line" >> "$NEW_FAIL_LOG"
    fi
  done
}

# 启动工作进程
for _ in $(seq 1 "$CONCURRENCY"); do
  worker &
done

echo -e "${YELLOW}开始重试失败的文件...${NC}"

# 读取失败日志并重新入队
cat "$FAIL_LOG" >&3

# 关闭生产者FD
exec 3>&-
wait

echo ""
echo -e "${BLUE}==========================================${NC}"
echo -e "${GREEN}重试完成！${NC}"

# 统计结果
if [ -s "$NEW_FAIL_LOG" ]; then
    NEW_FAIL_COUNT=$(wc -l < "$NEW_FAIL_LOG" | tr -d ' ')
    SUCCESS_COUNT=$((FAIL_COUNT - NEW_FAIL_COUNT))
    echo -e "重试成功: ${GREEN}$SUCCESS_COUNT${NC}"
    echo -e "仍然失败: ${RED}$NEW_FAIL_COUNT${NC}"
    echo ""
    echo -e "${YELLOW}新的失败列表保存在: $NEW_FAIL_LOG${NC}"
    
    # 如果还有失败，提供进一步建议
    if [ "$NEW_FAIL_COUNT" -gt 0 ]; then
        echo ""
        echo -e "${YELLOW}建议：${NC}"
        echo "  1. 检查CDN状态和网络连接"
        echo "  2. 增加超时时间后再次重试:"
        echo "     ./warmup-retry.sh $NEW_FAIL_LOG"
    fi
else
    echo -e "${GREEN}所有失败文件重试成功！${NC}"
    rm -f "$NEW_FAIL_LOG"
fi

echo -e "${BLUE}==========================================${NC}"
