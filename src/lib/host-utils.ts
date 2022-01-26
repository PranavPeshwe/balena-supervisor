import * as path from 'path';
import * as constants from './constants';
import * as fsUtils from './fs-utils';

// Takes a path relative to root `/` and returns a path in
// the host partition mount inside the container
export function pathOnHost(relPath: string) {
	return path.join(constants.rootMountPoint, relPath);
}

// Takes a path relative to the boot partition and returns the
// correct path under the root partition inside the container
export function pathOnBoot(relPath: string) {
	return pathOnHost(path.join(constants.bootMountPoint, relPath));
}

// Check if a path exists on the root partition
export async function existsOnHost(relPath: string) {
	return fsUtils.exists(pathOnHost(relPath));
}

// Check if a path exists under the boot partition
export async function existsOnBoot(relPath: string) {
	return fsUtils.exists(pathOnBoot(relPath));
}

// Receives an absolute path for a file under the boot partition (e.g. `/mnt/root/mnt/boot/config.txt`)
// and writes the given data. This function uses the best effort to write a file trying to minimize corruption
// due to a power cut. Given that the boot partition is a vfat filesystem, this means
// using write + sync
export async function writeToBootAbsolute(file: string, data: string | Buffer) {
	return await fsUtils.writeAndSyncFile(file, data);
}

// Receives a file path relative to the boot partition and writes the given data.
// This function uses the best effort to write a file trying to minimize corruption
// due to a power cut. Given that the boot partition is a vfat filesystem, this means
// using write + sync
export async function writeToBoot(
	file: string,
	data: string | Buffer,
): Promise<void> {
	return writeToBootAbsolute(pathOnBoot(file), data);
}
