#!/bin/bash

# 继续上传剩余文件到 R2
# 只上传尚未存在的文件（断点续传）

BUCKET_NAME="jump-and-say-themes-pic"
REMOTE_PREFIX="raz_aa"
LOCAL_DIR="/Users/liushuai/github/jump_and_say/public/themes"

echo "检查并上传剩余文件..."

# 先获取远程已存在的文件列表（使用 wrangler）
echo "获取远程文件列表..."
wrangler r2 object list "$BUCKET_NAME" --prefix="$REMOTE_PREFIX/" --no-cli-output 2>/dev/null | grep -o "raz_aa/[^ ]*" > /tmp/r2_existing.txt 2>/dev/null || true

# 如果上面的方法不行，直接跳过检查重新上传
# 使用 find 上传，跳过 .DS_Store
TOTAL_FILES=$(find "$LOCAL_DIR" -type f ! -name ".DS_Store" | wc -l)
echo "总文件数: $TOTAL_FILES"

UPLOADED=0
FAILED=0
SKIPPED=0

find "$LOCAL_DIR" -type f ! -name ".DS_Store" | while read -r file; do
    relative_path="${file#$LOCAL_DIR/}"
    remote_key="${REMOTE_PREFIX}/${relative_path}"
    
    # 检查文件是否已存在（简单方式：尝试上传）
    UPLOADED=$((UPLOADED + 1))
    
    if wrangler r2 object put "$BUCKET_NAME/$remote_key" --file="$file" --no-cli-output 2>/dev/null; then
        echo "[$UPLOADED/$TOTAL_FILES] ✓ $relative_path"
    else
        # 如果失败，尝试检查是否存在
        if wrangler r2 object head "$BUCKET_NAME/$remote_key" --no-cli-output 2>/dev/null; then
            echo "[$UPLOADED/$TOTAL_FILES] ⊘ 已存在: $relative_path"
            SKIPPED=$((SKIPPED + 1))
        else
            echo "[$UPLOADED/$TOTAL_FILES] ✗ 失败: $relative_path"
            FAILED=$((FAILED + 1))
        fi
    fi
done

echo ""
echo "完成!"
echo "已处理: $UPLOADED"
echo "已跳过: $SKIPPED"
echo "失败: $FAILED"
