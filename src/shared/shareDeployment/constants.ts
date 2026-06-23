import type { HtmlShareAccessMode } from '../htmlShare/constants';

export const ShareDeploymentIpc = {
  DetectProjectCandidates: 'shareDeployment:detectProjectCandidates',
  AnalyzeProjectDirectory: 'shareDeployment:analyzeProjectDirectory',
  CreateNodeDeployment: 'shareDeployment:createNodeDeployment',
  Get: 'shareDeployment:get',
  GetByLocalService: 'shareDeployment:getByLocalService',
} as const;

export type ShareDeploymentIpc = (typeof ShareDeploymentIpc)[keyof typeof ShareDeploymentIpc];

export const ShareDeploymentCandidateSource = {
  Process: 'process',
  Workspace: 'workspace',
  Manual: 'manual',
} as const;

export type ShareDeploymentCandidateSource =
  (typeof ShareDeploymentCandidateSource)[keyof typeof ShareDeploymentCandidateSource];

export const ShareDeploymentPackageManager = {
  Npm: 'npm',
  Pnpm: 'pnpm',
  Yarn: 'yarn',
  Unknown: 'unknown',
} as const;

export type ShareDeploymentPackageManager =
  (typeof ShareDeploymentPackageManager)[keyof typeof ShareDeploymentPackageManager];

export const ShareDeploymentStatus = {
  Queued: 'queued',
  Deploying: 'deploying',
  Live: 'live',
  DeployFailed: 'deploy_failed',
  Expired: 'expired',
  Stopped: 'stopped',
} as const;

export type ShareDeploymentStatus =
  (typeof ShareDeploymentStatus)[keyof typeof ShareDeploymentStatus];

export interface ShareDeploymentProjectCandidate {
  directory: string;
  source: ShareDeploymentCandidateSource;
  confidence: number;
  reason?: string;
}

export interface ShareDeploymentDetectCandidatesInput {
  localServiceUrl: string;
  workingDirectory?: string;
}

export interface ShareDeploymentDetectCandidatesResult {
  success: boolean;
  candidates: ShareDeploymentProjectCandidate[];
  error?: string;
}

export interface ShareDeploymentAnalyzeProjectInput {
  projectDirectory: string;
  localServiceUrl?: string;
}

export interface ShareDeploymentProjectAnalysis {
  success: boolean;
  projectDirectory: string;
  packageName?: string;
  packageVersion?: string;
  packageManager: ShareDeploymentPackageManager;
  nodeVersion: string;
  installCommand: string;
  startCommand: string;
  port?: number;
  totalFiles: number;
  totalBytes: number;
  excludedCount: number;
  warnings: string[];
  blockers: string[];
  error?: string;
}

export interface ShareDeploymentCreateNodeInput {
  sessionId: string;
  artifactId: string;
  title: string;
  localServiceUrl: string;
  projectDirectory: string;
  accessMode?: HtmlShareAccessMode;
  nodeVersion: string;
  installCommand: string;
  startCommand: string;
  port: number;
}

export interface ShareDeploymentEvent {
  id?: number;
  eventType?: string;
  message?: string;
  detailJson?: string;
  createdAt?: string;
}

export interface ShareDeploymentRecord {
  deploymentId: string;
  shareId?: string;
  url?: string;
  accessMode?: HtmlShareAccessMode;
  shareCode?: string;
  shareCodeUnavailable?: boolean;
  status: ShareDeploymentStatus;
  runtimeLanguage?: string;
  runtimeVersion?: string;
  packageManager?: string;
  installCommand?: string;
  startCommand?: string;
  targetPort?: number;
  sourceArchiveBytes?: number;
  sourceSha256?: string;
  provider?: string;
  providerRegion?: string;
  providerFunctionId?: string;
  providerEndpoint?: string;
  deployedAt?: string;
  expiresAt?: string;
  lastAccessedAt?: string;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
  events?: ShareDeploymentEvent[];
}

export interface ShareDeploymentResult {
  success: boolean;
  deployment?: ShareDeploymentRecord | null;
  analysis?: ShareDeploymentProjectAnalysis;
  warnings?: string[];
  error?: string;
  code?: number;
}
