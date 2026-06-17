#!/usr/bin/env node
import * as qvac from '@qvac/sdk';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { chunkCode, isCodeFile } from '../rag/chunker.js';
import { logFinetune } from '../logger.js';

const args = process.argv.slice(2);
function getArg(name, defaultValue) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultValue;
}

const codebasePath = resolve(getArg('path', '.'));
const epochs = parseInt(getArg('epochs', '3'), 10);
const outputDir = resolve(getArg('output', './finetune-output'));
const modelType = getArg('model', 'llm');

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '__pycache__',
  'coverage', 'vendor', 'target', 'logs',
]);

function walkDir(dir, files = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return files; }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;
    const fullPath = join(dir, entry);
    let stat;
    try { stat = statSync(fullPath); } catch { continue; }

    if (stat.isDirectory()) {
      walkDir(fullPath, files);
    } else if (stat.isFile() && stat.size <= 200_000 && isCodeFile(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

function generateTrainingData(files) {
  const pairs = [];

  for (const filePath of files) {
    try {
      const source = readFileSync(filePath, 'utf-8');
      const relPath = relative(codebasePath, filePath);
      const chunks = chunkCode(source, relPath);

      for (const chunk of chunks) {
        // Pattern 1: "What does [function/class] do?" → code explanation
        const firstLine = chunk.text.split('\n')[0].trim();
        if (firstLine.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?class\s+(\w+)/)) {
          const name = firstLine.match(/(?:function|class)\s+(\w+)/)?.[1];
          if (name) {
            pairs.push({
              instruction: `Explain the ${name} in ${relPath}`,
              input: chunk.text,
              output: `The \`${name}\` in \`${relPath}\` (lines ${chunk.startLine}-${chunk.endLine}) is defined as follows:\n\n\`\`\`\n${chunk.text.slice(0, 500)}\n\`\`\``,
            });
          }
        }

        // Pattern 2: Code completion
        if (chunk.text.length > 200) {
          const midpoint = Math.floor(chunk.text.length * 0.4);
          const prefix = chunk.text.slice(0, midpoint);
          const suffix = chunk.text.slice(midpoint);
          pairs.push({
            instruction: `Complete the following code in ${relPath}:`,
            input: prefix,
            output: suffix.slice(0, 300),
          });
        }

        // Pattern 3: What file handles X?
        pairs.push({
          instruction: `What code handles the functionality in ${relPath}?`,
          input: '',
          output: `The file \`${relPath}\` contains:\n\n\`\`\`\n${chunk.text.slice(0, 400)}\n\`\`\`\n\nLines ${chunk.startLine}-${chunk.endLine}.`,
        });
      }
    } catch {
      // skip unreadable
    }
  }

  return pairs;
}

async function main() {
  console.log(`\n  DevBrain Fine-Tuning — QVAC Fabric LoRA\n`);
  console.log(`  Codebase: ${codebasePath}`);
  console.log(`  Epochs: ${epochs}`);
  console.log(`  Output: ${outputDir}\n`);

  // Scan codebase
  const files = walkDir(codebasePath);
  console.log(`  Found ${files.length} code files`);
  logFinetune('scan', { files: files.length });

  // Generate training data
  const trainingData = generateTrainingData(files);
  console.log(`  Generated ${trainingData.length} training pairs`);
  logFinetune('data_generated', { pairs: trainingData.length });

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const dataPath = join(outputDir, 'training-data.json');
  writeFileSync(dataPath, JSON.stringify(trainingData, null, 2));
  console.log(`  Saved training data to ${dataPath}`);

  // Fine-tune
  console.log('  Starting LoRA fine-tuning...');
  logFinetune('training_start', { epochs, pairs: trainingData.length });

  // SDK exposes finetune() or fineTune() depending on version
  const finetuneFn = qvac.finetune || qvac.fineTune;
  if (!finetuneFn) {
    throw new Error('qvac.finetune() not available in this SDK version');
  }

  try {
    const result = await finetuneFn({
      baseModel: qvac.QWEN3_4B_INST_Q4_K_M,
      trainingData: trainingData.map((p) => ({
        messages: [
          { role: 'system', content: 'You are a code intelligence assistant specialized in this codebase.' },
          { role: 'user', content: p.instruction + (p.input ? `\n\n${p.input}` : '') },
          { role: 'assistant', content: p.output },
        ],
      })),
      config: {
        epochs,
        loraRank: 16,
        loraAlpha: 32,
        learningRate: 2e-4,
        batchSize: 4,
        outputPath: join(outputDir, 'devbrain-lora-adapter'),
      },
      onProgress: (epoch, step, loss) => {
        if (step % 10 === 0) {
          console.log(`      Epoch ${epoch}/${epochs} | Step ${step} | Loss: ${loss.toFixed(4)}`);
          logFinetune('progress', { epoch, step, loss });
        }
      },
    });

    console.log(`\n  Done. Adapter: ${result.outputPath || outputDir}`);
    console.log(`  Final loss: ${result.finalLoss?.toFixed(4) || 'N/A'}`);
    logFinetune('complete', { outputPath: result.outputPath, finalLoss: result.finalLoss });

  } catch (err) {
    console.error(`\n  Fine-tuning failed: ${err.message}`);
    console.error('  Training data saved — can be used with qvac.finetune() manually.\n');
    logFinetune('error', { error: err.message });

    const summaryPath = join(outputDir, 'README.md');
    writeFileSync(summaryPath, `# DevBrain Fine-Tuning Data

Generated ${trainingData.length} training pairs from ${files.length} files.

## Usage with QVAC Fabric

\`\`\`javascript
import * as qvac from '@qvac/sdk';

const result = await qvac.finetune({
  baseModel: qvac.QWEN3_4B_INST_Q4_K_M,
  trainingData: require('./training-data.json'),
  config: { epochs: ${epochs}, loraRank: 16 }
});
\`\`\`

## Training Data Format
Each entry has: instruction, input, output fields.
Total pairs: ${trainingData.length}
Source files: ${files.length}
Generated: ${new Date().toISOString()}
`);
    console.log(`  Summary saved to ${summaryPath}`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
