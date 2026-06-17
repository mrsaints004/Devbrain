# Hardware Specifications & Reproducibility Guide

## Primary Device

| Spec | Details |
|---|---|
| **Device** | MacBook Pro (Mac14,9) |
| **Chip** | Apple M2 Pro — 10 cores (6P + 4E), 16-core GPU |
| **RAM** | 16 GB unified memory |
| **Storage** | 512GB SSD (~340 GB free) |
| **OS** | macOS 15.4.1 (Sequoia) |
| **Node.js** | v24.13.0 |

## System Profiler Screenshot

> System profiler output captured via `system_profiler SPHardwareDataType`:
>
> ```
> Model Name: MacBook Pro
> Model Identifier: Mac14,9
> Chip: Apple M2 Pro
> Total Number of Cores: 10 (6 performance and 4 efficiency)
> Memory: 16 GB
> ```

---

## Models Memory Footprint

| Model | Role | Size | RAM Usage |
|---|---|---|---|
| Qwen3 4B Instruct Q4_K_M | Primary LLM | ~2.6 GB | ~3.0 GB loaded |
| GTE-Large FP16 | Embeddings | ~0.7 GB | ~0.8 GB loaded |
| Qwen3-VL 2B Multimodal Q4_K | Vision (optional) | ~1.5 GB | ~1.8 GB loaded |
| Whisper Base Q0F16 | STT (optional) | ~150 MB | ~200 MB loaded |
| Supertonic | TTS (on-demand) | ~500 MB | Loaded per-call |

**Peak memory with all models:** ~5.8 GB (fits within 16 GB with room for OS + apps)

---

## Reproduction Steps

### Prerequisites

1. macOS with Apple Silicon (M1 or later) — or Linux with compatible GPU
2. Node.js 22+ installed (`brew install node` or from nodejs.org)
3. Git installed
4. 10 GB free disk space (for model downloads on first run)
5. Internet connection (first run only — downloads models from QVAC registry)

### Step-by-Step Setup

```bash
# 1. Clone the repository
git clone https://github.com/AYANscyy2/devbrain.git
cd devbrain

# 2. Install Node.js dependencies
npm install

# 3. Run tests to verify setup
npm test

# 4. Start DevBrain against any codebase (e.g., itself)
node src/index.js --path ./ --watch

# 5. Open the web interface
open http://localhost:3000

# 6. (Optional) Connect a P2P client from another device
node src/p2p/client.js --key <displayed-provider-key> --interactive

# 7. (Optional) Run fine-tuning on a codebase
node src/finetune/train.js --path /path/to/your/project --epochs 3
```

### First Run

On first run, QVAC SDK will download models from the registry:
- Qwen3 4B (~2.6 GB)
- GTE-Large (~0.7 GB)
- Vision model (~1.5 GB, optional — skipped if unavailable)
- STT model (~150 MB, optional — skipped if unavailable)

Total download: ~5-8 GB depending on optional models. After this, DevBrain runs fully offline.

### Verification

After starting, verify the system is operational:

```bash
# Check status
curl http://localhost:3000/api/status | python3 -m json.tool

# Run a test query
curl -X POST http://localhost:3000/api/query \
  -H 'Content-Type: application/json' \
  -d '{"query": "What files are in this project?"}'

# Check inference logs
curl http://localhost:3000/api/logs?limit=10

# Run test suite
npm test
```

---

## CLI Options

```
--path <dir>       Codebase directory to index (default: current dir)
--port <number>    HTTP server port (default: 3000)
--workspace <name> RAG workspace name (default: devbrain-default)
--watch            Enable real-time file monitoring + code smell detection
--no-p2p           Skip P2P provider startup
```

---

## Performance Benchmarks (M2 Pro 16 GB)

| Metric | Value |
|---|---|
| Model Load (all) | ~12s |
| TTFT (first token) | ~100-200ms |
| Tokens/sec (Qwen3 4B Q4) | ~35-45 tok/s |
| RAG Search (GTE-Large) | ~30-50ms |
| Full Query E2E | ~4-8s |
| Code Smell Analysis | ~3-5s per file |
| Re-indexing (100 files) | ~5-10s |
