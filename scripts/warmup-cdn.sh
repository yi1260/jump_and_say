#!/usr/bin/env bash
set -euo pipefail

# CDN预热脚本 - 遍历R2存储桶中的所有文件进行预热
# 使用方法: 
#   ./warmup-cdn.sh              # 预热所有文件
#   ./warmup-cdn.sh RAZ/         # 仅预热RAZ目录
#   ./warmup-cdn.sh assets/      # 仅预热assets目录

ENDPOINT="https://688d49f1eed2291bdb00597551717b53.r2.cloudflarestorage.com"
BUCKET="jump-and-say-themes-pic"
PREFIX="${1:-}"  # 可以通过参数指定前缀，如 "RAZ/" 或 "assets/"

BASE="https://cdn.maskmysheet.com"
CONCURRENCY=20
FAIL_LOG="warmup_fail.log"
LOCK_FILE="/tmp/warmup_output.lock"
PROGRESS_FILE="/tmp/warmup_progress.txt"
SUCCESS_COUNT=0
FAIL_COUNT=0

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 清空失败日志和进度文件
: > "$FAIL_LOG"
: > "$PROGRESS_FILE"
rm -f "$LOCK_FILE"

echo -e "${BLUE}==========================================${NC}"
echo -e "${BLUE}CDN预热工具${NC}"
echo -e "${BLUE}==========================================${NC}"
echo "存储桶: $BUCKET"
echo "CDN域名: $BASE"
if [ -n "$PREFIX" ]; then
    echo "目录前缀: $PREFIX"
fi
echo "并发数: $CONCURRENCY"
echo ""

# 检查依赖
if ! command -v aws &> /dev/null; then
    echo -e "${RED}错误: 需要安装 AWS CLI${NC}"
    echo "安装方法: pip install awscli"
    exit 1
fi

# --- FIFO queue ---
FIFO="$(mktemp -u)"
mkfifo "$FIFO"
exec 3<>"$FIFO"
rm -f "$FIFO"

# 带锁的输出函数
log_result() {
  local status="$1" url="$2" code="$3"
  (
    flock -x 200 2>/dev/null || true
    if [[ "$status" == "ok" ]]; then
      echo -e "${GREEN}✓${NC} $url"
    else
      echo -e "${RED}✗ [$code]${NC} $url"
      printf "[FAIL] %s %s\n" "$code" "$url" >> "$FAIL_LOG"
    fi
    echo "$url" >> "$PROGRESS_FILE"
  ) 200>"$LOCK_FILE"
}

worker() {
  while IFS= read -r url <&3; do
    [[ -z "$url" ]] && continue

    code=$(curl -sS --retry 2 --retry-delay 1 --connect-timeout 5 -m 30 \
      -o /dev/null -w "%{http_code}" "$url" 2>/dev/null) || code="000"
    
    [[ -z "$code" ]] && code="000"

    if [[ "$code" == "200" || "$code" == "206" || "$code" == "304" ]]; then
      log_result "ok" "$url" "$code"
    else
      log_result "fail" "$url" "$code"
    fi
  done
}

# 启动工作进程
for _ in $(seq 1 "$CONCURRENCY"); do
  worker &
done

echo -e "${YELLOW}正在列出存储桶中的文件...${NC}"

TEMP_KEYS=$(mktemp)
aws s3api list-objects-v2 \
  --bucket "$BUCKET" \
  --prefix "$PREFIX" \
  --endpoint-url "$ENDPOINT" \
  --query "Contents[].Key" \
  --output text \
| tr '\t' '\n' \
| sed '/^[[:space:]]*$/d' > "$TEMP_KEYS"

TOTAL=$(wc -l < "$TEMP_KEYS" | tr -d ' ')
echo -e "${GREEN}找到 $TOTAL 个文件${NC}"
echo ""

if [[ "$TOTAL" -eq 0 ]]; then
  echo -e "${YELLOW}没有找到文件${NC}"
  rm -f "$TEMP_KEYS"
  exit 0
fi

echo -e "${YELLOW}开始预热...${NC}"
echo ""

PROCESSED=0
while IFS= read -r key; do
  [[ -z "$key" ]] && continue
  enc_key=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$key''', safe='/'))" 2>/dev/null || \
            python3 -c "import urllib.parse; print(urllib.parse.quote('$key', safe='/'))" 2>/dev/null || \
            echo "$key")
  printf "%s/%s\n" "${BASE%/}" "$enc_key" >&3
  
  PROCESSED=$((PROCESSED + 1))
  if [[ $((PROCESSED % 100)) -eq 0 ]]; then
    echo -e "${YELLOW}已入队: $PROCESSED / $TOTAL${NC}" >&2
  fi
done < "$TEMP_KEYS"

rm -f "$TEMP_KEYS"

# 关闭生产者FD，让工作进程退出
exec 3>&-
wait

echo ""
echo -e "${BLUE}==========================================${NC}"
echo -e "${GREEN}预热完成！${NC}"

# 统计结果
if [ -f "$FAIL_LOG" ] && [ -s "$FAIL_LOG" ]; then
    FAIL_COUNT=$(wc -l < "$FAIL_LOG" | tr -d ' ')
    SUCCESS_COUNT=$((TOTAL - FAIL_COUNT))
    echo -e "总数: ${BLUE}$TOTAL${NC}"
    echo -e "成功: ${GREEN}$SUCCESS_COUNT${NC}"
    echo -e "失败: ${RED}$FAIL_COUNT${NC}"
    echo ""
    echo -e "${YELLOW}失败列表保存在: $FAIL_LOG${NC}"
    echo ""
    echo -e "${YELLOW}建议重试失败的文件：${NC}"
    echo "  ./warmup-cdn.sh ${PREFIX} 2>&1 | tee warmup_retry.log"
else
    echo -e "全部成功: ${GREEN}$TOTAL${NC} 个文件"
    echo ""
    echo -e "${GREEN}所有文件预热完成！${NC}"
fi

# 清理临时文件
rm -f "$LOCK_FILE" "$PROGRESS_FILE"

echo -e "${BLUE}==========================================${NC}"
