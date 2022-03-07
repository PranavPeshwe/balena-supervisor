import * as fs from 'fs';
import { dirname } from 'path';

import { exec, unlinkAll } from './fs-utils';

// Equivalent to `drwxrwxrwt`
const STICKY_WRITE_PERMISSIONS = 0o1777;
export const NOBODY_UID = 65534;

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
	await exec(`lockfile -r 0 ${path}`, { uid });
}

export async function unlock(path: string) {
	// Removing the updates.lock file releases the lock
	return await unlinkAll(path);
}

export function unlockSync(path: string) {
	return fs.unlinkSync(path);
}
