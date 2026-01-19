#!/bin/bash

# 上传 public/themes 到 R2 bucket
# 目标: jump-and-say-themes-pic / raz_aa/
# 保持本地文件夹结构

BUCKET_NAME="jump-and-say-themes-pic"
REMOTE_PREFIX="raz_aa"
LOCAL_DIR="/Users/liushuai/github/jump_and_say/public/themes"

echo "开始上传 themes 到 R2..."
echo "Bucket: $BUCKET_NAME"
echo "远程路径: $REMOTE_PREFIX/"
echo ""

# 统计文件数量
TOTAL_FILES=$(find "$LOCAL_DIR" -type f ! -name ".DS_Store" | wc -l)
UPLOADED=0
FAILED=0

# 使用 find 递归遍历所有文件并上传
find "$LOCAL_DIR" -type f ! -name ".DS_Store" | while read -r file; do
    # 获取相对路径
    relative_path="${file#$LOCAL_DIR/}"
    
    # 构建远程 key（移除 .DS_Store）
    remote_key="${REMOTE_PREFIX}/${relative_path}"
    
    # 打印进度
    UPLOADED=$((UPLOADED + 1))
    echo "[$UPLOADED/$TOTAL_FILES] 上传: $relative_path"
    
    # 上传文件
    if wrangler r2 object put "$BUCKET_NAME/$remote_key" --file="$file" 2>/dev/null; then
        echo "  ✓ 成功"
    else
        echo "  ✗ 失败"
        FAILED=$((FAILED + 1))
    fi
done

echo ""
echo "上传完成!"
echo "成功: $UPLOADED"
echo "失败: $FAILED"
