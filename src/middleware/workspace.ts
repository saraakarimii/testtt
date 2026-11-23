import type { NextFunction, Request, Response } from 'express';
import { getOrCreateLocalWorkspaceUser } from '../db/users.js';

export interface DbUser {
  id: number;
  uid: string;
  email: string;
}

export interface WorkspaceRequest extends Request {
  dbUser?: DbUser;
}

// ChromaBook runs as a single-user local workspace. No sign-in or identity provider is used.
// Existing data stays attached to the oldest existing workspace owner.
let localUserPromise: ReturnType<typeof getOrCreateLocalWorkspaceUser> | null = null;

export const attachLocalWorkspace = async (req: WorkspaceRequest, res: Response, next: NextFunction) => {
  try {
    localUserPromise ??= getOrCreateLocalWorkspaceUser();
    req.dbUser = await localUserPromise;
    next();
  } catch (error) {
    localUserPromise = null;
    console.error('Failed to initialize local ChromaBook workspace:', error);
    res.status(500).json({ detail: 'Failed to initialize the local workspace.' });
  }
};
