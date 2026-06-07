# Hardware Specifications & Reproducibility Guide

## Primary Device

| Spec | Details |
|---|---|
| **Device** | MacBook Pro / Mac Mini / iMac (Apple Silicon) |
| **Chip** | Apple M-series (M1/M2/M3/M4) |
| **RAM** | 16GB unified memory (minimum) / 32GB (recommended) |
| **Storage** | 512GB+ SSD (10GB free for models) |
| **OS** | macOS 14+ (Sonoma or later) |
| **Node.js** | v22.17+ |

> **Note:** Replace this section with your actual hardware specs and include a screenshot of "About This Mac" / System Profiler before submission.

### How to Get System Info

```bash
# macOS system info
system_profiler SPHardwareDataType
sw_vers
node --version
```

---

## Reproduction Steps

### Prerequisites

1. macOS with Apple Silicon (M1 or later)
2. Node.js 22.17+ installed (`brew install node` or from nodejs.org)
3. Git installed
4. 10GB free disk space (for model downloads on first run)
5. Internet connection (first run only — downloads models from QVAC registry)

### Step-by-Step Setup

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_USERNAME/devbrain.git
cd devbrain

# 2. Install Node.js dependencies
npm install

# 3. Run DevBrain against any codebase
node src/index.js --path /path/to/your/project --watch

# 4. Open the web interface
open http://localhost:3000

# 5. (Optional) Start a P2P client from another device
node src/p2p/client.js --key <displayed-provider-key> --interactive

# 6. (Optional) Run fine-tuning
node src/finetune/train.js --path /path/to/your/project --epochs 3
```

### First Run

On first run, QVAC SDK will download models from the registry:
- Psy 4B (~2.6GB)
- GTE-Large (~0.7GB)
- Vision model (~4GB, optional)
- TTS/STT models (~650MB, optional)

Total download: ~8GB. After this, DevBrain runs fully offline.

### Verification

After starting, verify the system is operational:

```bash
# Check status
curl http://localhost:3000/api/status

# Run a test query
curl -X POST http://localhost:3000/api/query \
  -H 'Content-Type: application/json' \
  -d '{"query": "What files are in this project?"}'

# Check inference logs
curl http://localhost:3000/api/logs?limit=10
```

---

## Performance Benchmarks (Expected)

| Metric | Apple M1 16GB | Apple M2 Pro 32GB | Apple M3 Max 64GB |
|---|---|---|---|
| Model Load Time | ~15s | ~8s | ~5s |
| TTFT (first token) | ~200ms | ~100ms | ~60ms |
| Tokens/sec | ~25 tok/s | ~45 tok/s | ~80 tok/s |
| RAG Search | ~50ms | ~30ms | ~20ms |
| Full Query E2E | ~8s | ~4s | ~2s |

> These are estimates. Actual performance will be captured in `logs/inference-log.json` during your demo run.

---

## Demo Video Script Outline

1. **Introduction** (30s): Show system specs, explain what DevBrain does
2. **Startup** (30s): Show `node src/index.js --path ./project --watch`
3. **Basic Query** (60s): Ask code questions, show streaming responses + pipeline
4. **Tool Calling** (30s): Show agent reading files and searching code
5. **Image Analysis** (30s): Drop a screenshot, get analysis
6. **P2P Delegation** (60s): Connect from phone/second machine
7. **Performance** (30s): Show dashboard metrics (TPS, TTFT)
8. **Logs** (20s): Show structured inference logs

**Total: ~5 minutes**

---

## Submission Checklist

- [ ] Public GitHub repository
- [ ] Apache 2.0 license
- [ ] apis.json with API disclosure
- [ ] README with setup instructions
- [ ] HARDWARE.md with specs (this file)
- [ ] System Profiler screenshots
- [ ] Demo video (unlisted YouTube, < 5 min)
- [ ] inference-log.json from demo run
- [ ] DoraHacks project page
- [ ] Team members listed
- [ ] Track selected: General Purpose
