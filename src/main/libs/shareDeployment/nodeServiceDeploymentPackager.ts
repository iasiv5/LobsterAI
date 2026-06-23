import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import yazl from 'yazl';

import type { ShareDeploymentProjectAnalysis } from '../../../shared/shareDeployment/constants';
import {
  buildNodeServiceProjectPackagePlan,
  NODE_SERVICE_DEPLOYMENT_LIMITS,
  type NodeServicePackageEntry,
} from './nodeServiceProjectAnalyzer';

export interface NodeServiceDeploymentPackageInput {
  projectDirectory: string;
  localServiceUrl?: string;
}

export interface NodeServiceDeploymentPackageResult {
  archivePath: string;
  sourceSha256: string;
  analysis: ShareDeploymentProjectAnalysis;
  totalFiles: number;
  totalBytes: number;
  archiveBytes: number;
  warnings: string[];
}

async function writeZip(entries: NodeServicePackageEntry[]): Promise<{
  archivePath: string;
  sourceSha256: string;
  archiveBytes: number;
}> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lobster-node-deploy-'));
  const archivePath = path.join(tempDir, 'source.zip');
  const zipFile = new yazl.ZipFile();

  zipFile.on('error', (error) => {
    (zipFile.outputStream as unknown as { destroy(error: Error): void }).destroy(error as Error);
  });

  for (const entry of entries) {
    zipFile.addFile(entry.absolutePath, entry.archiveName);
  }

  const outputStream = fs.createWriteStream(archivePath);
  const pipelinePromise = pipeline(zipFile.outputStream, outputStream);
  zipFile.end();
  await pipelinePromise;

  const stat = await fs.promises.stat(archivePath);
  if (stat.size > NODE_SERVICE_DEPLOYMENT_LIMITS.MaxArchiveBytes) {
    throw new Error(
      `Deployment package is too large. The limit is ${Math.floor(NODE_SERVICE_DEPLOYMENT_LIMITS.MaxArchiveBytes / 1024 / 1024)}MB.`,
    );
  }

  const buffer = await fs.promises.readFile(archivePath);
  return {
    archivePath,
    sourceSha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    archiveBytes: stat.size,
  };
}

export async function packageNodeServiceDeployment(
  input: NodeServiceDeploymentPackageInput,
): Promise<NodeServiceDeploymentPackageResult> {
  const plan = await buildNodeServiceProjectPackagePlan({
    projectDirectory: input.projectDirectory,
    localServiceUrl: input.localServiceUrl,
  });
  if (!plan.analysis.success) {
    throw new Error(plan.analysis.blockers.join('\n') || 'Project cannot be deployed.');
  }

  const archive = await writeZip(plan.entries);
  return {
    ...archive,
    analysis: plan.analysis,
    totalFiles: plan.analysis.totalFiles,
    totalBytes: plan.analysis.totalBytes,
    warnings: plan.analysis.warnings,
  };
}
