import * as fs from 'fs';
import { dirname } from 'path';
import { TypedError } from 'typed-error';

import { exec, unlinkAll } from './fs-utils';

// Equivalent to `drwxrwxrwt`
const STICKY_WRITE_PERMISSIONS = 0o1777;
export const NOBODY_UID = 65534;

/**
 * Internal lockfile manager to track files in memory
 */
// Track locksTaken, so that the proper locks can be cleaned up on process exit
const locksTaken: { [lockName: string]: boolean } = {};

// Returns all current locks taken, as they've been stored in-memory.
export const getLocksTaken = (): string[] => Object.keys(locksTaken);

// Try to clean up any existing locks when the process exits
process.on('exit', () => {
	for (const lockName of getLocksTaken()) {
		try {
			unlockSync(lockName);
		} catch (e) {
			// Ignore unlocking errors
		}
	}
});

interface ChildProcessError {
	code: number;
	stderr: string;
	stdout: string;
}

export class LockfileExistsError extends TypedError
	implements ChildProcessError {
	public code: number;
	public stderr: string;
	public stdout: string;

	constructor(path: string) {
		super();
		this.code = 73;
		this.stderr = `lockfile: Sorry, giving up on "${path}"`;
		this.stdout = '';
	}
}

export async function lock(path: string, uid = NOBODY_UID) {
	/**
	 * Set parent directory permissions to `drwxrwxrwt` (octal 1777), which are needed
	 * for lockfile binary to run successfully as the `nobody` (UID 65534) user.
	 * Otherwise the `nobody` user will not have write permissions to the necessary
	 * bind-mounted lockfile directories. `chmod` does not fail or throw if the
	 * directory already has the proper permissions.
	 */
	await fs.promises.chmod(dirname(path), STICKY_WRITE_PERMISSIONS);

	// Run the lockfile binary as UID 65534. See https://linux.die.net/man/1/lockfile
	// `-r 0` means that lockfile will not retry if the lock exists.
	try {
		// Lock the file using binary
		await exec(`lockfile -r 0 ${path}`, { uid });
		// Store a lock in memory as taken
		locksTaken[path] = true;
	} catch (error) {
		// Code 73 refers to EX_CANTCREAT (73) in sysexits.h, or:
		// A (user specified) output file cannot be created.
		// See: https://nxmnpg.lemoda.net/3/sysexits
		if (error instanceof LockfileExistsError) {
			// If error code is 73, updates.lock file already exists.
			// Throw this error directly where it's parsed into a Supervisor-specific
			// error message in lib/update-lock.ts
			throw error;
		} else {
			/**
			 * In theory, we should get a child process error with code 73,
			 * indicating the lockfile already exists. Therefore any other process
			 * error code should be thrown and stop the parent process as something
			 * unexpected has gone wrong. Other errors that are not the typical "file exists"
			 * errors include but aren't limited to:
			 *   - running out of file descriptors
			 *   - binary corruption
			 *   - other systems-based errors
			 */
			throw new Error(
				`Error locking updates: ${JSON.stringify(
					{
						code: (error as ChildProcessError).code,
						stderr: (error as ChildProcessError).stderr,
					},
					null,
					2,
				)}`,
			);
		}
	}
}

export async function unlock(path: string): Promise<void> {
	// Removing the updates.lock file releases the lock
	await unlinkAll(path);
	// Remove lockfile's in-memory tracking of a file
	delete locksTaken[path];
}

export function unlockSync(path: string) {
	return fs.unlinkSync(path);
}
