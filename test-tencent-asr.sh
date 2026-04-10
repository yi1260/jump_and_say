#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "========================================"
echo "  腾讯云 ASR 接口测试脚本"
echo "========================================"
echo ""

# 依赖检查
command -v node >/dev/null 2>&1 || {
  echo -e "${RED}错误: 未找到 node，请先安装 Node.js${NC}"
  exit 1
}

command -v ffmpeg >/dev/null 2>&1 || {
  echo -e "${RED}错误: 未找到 ffmpeg，请先安装 ffmpeg${NC}"
  exit 1
}

# 检查 SDK
node -e "require('tencentcloud-sdk-nodejs')" >/dev/null 2>&1 || {
  echo -e "${RED}错误: 未安装 tencentcloud-sdk-nodejs${NC}"
  echo "请先执行: npm install tencentcloud-sdk-nodejs"
  exit 1
}

# 读取 .env.local
if [ ! -f ".env.local" ]; then
  echo -e "${RED}错误: .env.local 文件不存在${NC}"
  exit 1
fi

echo -e "${YELLOW}从 .env.local 读取密钥...${NC}"

set -a
# shellcheck disable=SC1091
source .env.local
set +a

# 兼容两种变量名
TENCENT_SECRET_ID="${TENCENT_SECRET_ID:-${TENCENTCLOUD_SECRET_ID:-}}"
TENCENT_SECRET_KEY="${TENCENT_SECRET_KEY:-${TENCENTCLOUD_SECRET_KEY:-}}"

# 去掉可能的 CRLF
TENCENT_SECRET_ID="$(printf '%s' "$TENCENT_SECRET_ID" | tr -d '\r')"
TENCENT_SECRET_KEY="$(printf '%s' "$TENCENT_SECRET_KEY" | tr -d '\r')"

export TENCENT_SECRET_ID
export TENCENT_SECRET_KEY

if [ -z "$TENCENT_SECRET_ID" ] || [ -z "$TENCENT_SECRET_KEY" ]; then
  echo -e "${RED}错误: 未找到 TENCENT_SECRET_ID 或 TENCENT_SECRET_KEY${NC}"
  exit 1
fi

echo -e "${GREEN}密钥已加载:${NC}"
echo "  SecretId: ${TENCENT_SECRET_ID:0:10}...${TENCENT_SECRET_ID: -6}"
echo "  SecretKey: ${TENCENT_SECRET_KEY:0:4}...${TENCENT_SECRET_KEY: -4}"
echo ""

# 创建测试音频
echo -e "${YELLOW}创建测试音频文件...${NC}"
TEST_WAV="/tmp/test_tencent_asr.wav"

ffmpeg -f lavfi -i anullsrc=r=16000:cl=mono -t 1 -ac 1 -ar 16000 -sample_fmt s16 -y "$TEST_WAV" -loglevel error

if [ ! -f "$TEST_WAV" ]; then
  echo -e "${RED}错误: 无法创建测试音频文件${NC}"
  exit 1
fi

echo -e "${GREEN}测试音频已创建: $TEST_WAV${NC}"
echo ""

echo -e "${YELLOW}测试腾讯云 ASR API...${NC}"
echo ""

node - <<'NODE'
const fs = require('fs');
const tencentcloud = require('tencentcloud-sdk-nodejs');

const AsrClient = tencentcloud.asr.v20190614.Client;

const secretId = (process.env.TENCENT_SECRET_ID || '').trim();
const secretKey = (process.env.TENCENT_SECRET_KEY || '').trim();
const audioPath = '/tmp/test_tencent_asr.wav';

console.log('SecretId:', secretId ? `${secretId.slice(0, 10)}...${secretId.slice(-6)}` : 'undefined');
console.log('SecretKey:', secretKey ? `${secretKey.slice(0, 4)}...${secretKey.slice(-4)}` : 'undefined');
console.log('');

if (!secretId || !secretKey) {
  console.error('\x1b[31m错误:\x1b[0m SecretId 或 SecretKey 为空');
  process.exit(1);
}

if (!fs.existsSync(audioPath)) {
  console.error('\x1b[31m错误:\x1b[0m 测试音频不存在:', audioPath);
  process.exit(1);
}

const audioBytes = fs.readFileSync(audioPath);
const audioBase64 = audioBytes.toString('base64');

const client = new AsrClient({
  credential: {
    secretId,
    secretKey,
  },
  region: 'ap-shanghai',
  profile: {
    signMethod: 'TC3-HMAC-SHA256',
    httpProfile: {
      endpoint: 'asr.tencentcloudapi.com',
      reqMethod: 'POST',
      reqTimeout: 30,
    },
  },
});

console.log('正在调用 SentenceRecognition...');
console.log('原始音频字节数:', audioBytes.length);
console.log('Base64 长度:', audioBase64.length);
console.log('');

const params = {
  EngSerViceType: '16k_en',
  SourceType: 1,
  VoiceFormat: 'wav',
  Data: audioBase64,
  DataLen: audioBytes.length,
};

const startTime = Date.now();

client.SentenceRecognition(params)
  .then((response) => {
    const duration = Date.now() - startTime;
    console.log('耗时:', duration, 'ms');
    console.log('');
    console.log('\x1b[32m成功!\x1b[0m');
    console.log('识别结果:', response.Result || '(空)');
    console.log('RequestId:', response.RequestId);
    console.log('AudioDuration:', response.AudioDuration);
    process.exit(0);
  })
  .catch((err) => {
    const duration = Date.now() - startTime;
    console.log('耗时:', duration, 'ms');
    console.log('');
    console.error('\x1b[31m错误:\x1b[0m', err.message || err);
    console.error('错误码:', err.code || '(无)');
    console.error('RequestId:', err.requestId || '(无)');

    if (err.stack) {
      console.error('');
      console.error('Stack:');
      console.error(err.stack);
    }

    process.exit(1);
  });
NODE

rm -f "$TEST_WAV"