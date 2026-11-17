export const FILE_API_SCOPES = [
  "files:read",
  "files:write",
  "files:delete",
] as const;

export type FileApiScope = (typeof FILE_API_SCOPES)[number];

export type FileApiTokenStatus = {
  configured: boolean;
  enabled: boolean;
  scopes: FileApiScope[];
  createdAt?: number;
  expiresAt?: number;
  fingerprint?: string;
  recoverable?: boolean;
};
