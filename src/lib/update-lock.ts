import * as Bluebird from 'bluebird';
import * as _ from 'lodash';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as Lock from 'rwlock';

import * as constants from './constants';
import {
	ENOENT,
	UpdatesLockedError,
	InternalInconsistencyError,
} from './errors';
import { getPathOnHost, pathExistsOnHost } from './fs-utils';
import * as config from '../config';
import * as lockfile from './lockfile';

const BASE_LOCK_DIR = '/tmp/balena-supervisor/services';

export function lockPath(appId: number, serviceName?: string): string {
	return path.join(BASE_LOCK_DIR, appId.toString(), serviceName ?? '');
}

function lockFilesOnHost(appId: number, serviceName: string): string[] {
	return getPathOnHost(
		...['updates.lock', 'resin-updates.lock'].map((filename) =>
			path.join(lockPath(appId), serviceName, filename),
		),
	);
}

/**
 * Check for rollback-{health|altboot}-breadcrumb, two files that exist while
 * rollback-{health|altboot}.service have not exited. If these files exist,
 * prevent reboot. If the Supervisor reboots while those services are still running,
 * the device may become stuck in an invalid state during HUP.
 */
export function abortIfHUPInProgress({
	force = false,
}: {
	force: boolean | undefined;
}): Promise<boolean | never> {
	return Promise.all(
		[
			'rollback-health-breadcrumb',
			'rollback-altboot-breadcrumb',
		].map((filename) =>
			pathExistsOnHost(path.join(constants.stateMountPoint, filename)),
		),
	).then((existsArray) => {
		const anyExists = existsArray.some((exists) => exists);
		if (anyExists && !force) {
			throw new UpdatesLockedError('Waiting for Host OS update to finish');
		}
		return anyExists;
	});
}

type LockFn = (key: string | number) => Bluebird<() => void>;
const locker = new Lock();
export const writeLock: LockFn = Bluebird.promisify(locker.async.writeLock, {
	context: locker,
});
export const readLock: LockFn = Bluebird.promisify(locker.async.readLock, {
	context: locker,
});

function dispose(release: () => void): Bluebird<void> {
	return Bluebird.map(lockfile.getLocksTaken(), (lockName) => {
		return lockfile.unlock(lockName);
	})
		.finally(release)
		.return();
}

/**
 * Try to take the locks for an application. If force is set, it will remove
 * all existing lockfiles before performing the operation
 *
 * TODO: convert to native Promises and async/await. May require native implementation of Bluebird's dispose / using
 *
 * TODO: Remove skipLock as it's not a good interface. If lock is called it should try to take the lock
 * without an option to skip.
 */
export function lock<T extends unknown>(
	appId: number,
	{ force = false, skipLock = false }: { force: boolean; skipLock?: boolean },
	fn: () => Resolvable<T>,
): Bluebird<T> {
	if (skipLock || appId == null) {
		return Bluebird.resolve(fn());
	}

	const takeTheLock = () => {
		return config
			.get('lockOverride')
			.then((lockOverride) => {
				return writeLock(appId)
					.tap((release: () => void) => {
						const lockDir = getPathOnHost(lockPath(appId));
						return Bluebird.resolve(fs.readdir(lockDir))
							.catchReturn(ENOENT, [])
							.mapSeries((serviceName) => {
								return Bluebird.mapSeries(
									lockFilesOnHost(appId, serviceName),
									(tmpLockName) => {
										return (
											Bluebird.try(() => {
												if (force || lockOverride) {
													return lockfile.unlock(tmpLockName);
												}
											})
												.then(() => {
													return lockfile.lock(tmpLockName);
												})
												// If lockfile exists, dispose of writeLock and throw a user-friendly error
												.catch(lockfile.LockfileExistsError, () => {
													return dispose(release).throw(
														new UpdatesLockedError(
															`Lockfile exists for ${JSON.stringify({
																serviceName,
																appId,
															})}`,
														),
													);
												})
												// Else, dispose of writeLock and throw error as-is
												.catch(
													(err: unknown) =>
														!(
															err instanceof lockfile.LockfileExistsError ||
															err instanceof UpdatesLockedError
														),
													(err) => {
														return dispose(release).throw(err as Error);
													},
												)
										);
									},
								);
							});
					})
					.disposer(dispose);
			})
			.catch((err) => {
				throw new InternalInconsistencyError(
					`Error getting lockOverride config value: ${err?.message ?? err}`,
				);
			});
	};

	const disposer = takeTheLock();
	if (disposer) {
		return Bluebird.using(disposer, fn as () => PromiseLike<T>);
	} else {
		return Bluebird.resolve(fn());
	}
}
