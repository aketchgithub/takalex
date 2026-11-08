// Evidence photo processing and storage.
//
// processPhoto: resize so the long side is at most 1280 px and save as JPEG
// at quality 0.6, then confirm the file is under the bucket's 2 MB limit
// (006_evidence_storage.sql). If it is not, retry at lower quality before
// giving up.
//
// Outbox photos live in the document directory (not the cache), so the OS
// never purges a photo that has not been uploaded yet.

import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import type { PhotoFiles } from "@/lib/outbox/types";
import { longSideResize } from "@/lib/outbox/validation";

export const MAX_LONG_SIDE_PX = 1280;
export const JPEG_QUALITY = 0.6;
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const FALLBACK_QUALITIES = [JPEG_QUALITY, 0.45, 0.3];

const OUTBOX_DIRECTORY = "outbox";

export type ProcessedPhoto = {
  uri: string;
  width: number;
  height: number;
  sizeBytes: number;
};

export async function processPhoto(sourceUri: string): Promise<ProcessedPhoto> {
  const original = await ImageManipulator.manipulate(sourceUri).renderAsync();
  let rendered = original;
  try {
    const resize = longSideResize(original.width, original.height, MAX_LONG_SIDE_PX);
    if (resize) {
      rendered = await ImageManipulator.manipulate(original).resize(resize).renderAsync();
    }

    for (const quality of FALLBACK_QUALITIES) {
      const saved = await rendered.saveAsync({ compress: quality, format: SaveFormat.JPEG });
      const file = new File(saved.uri);
      const sizeBytes = file.size;
      if (sizeBytes > 0 && sizeBytes < MAX_PHOTO_BYTES) {
        return { uri: saved.uri, width: saved.width, height: saved.height, sizeBytes };
      }
      if (file.exists) file.delete();
    }
    throw new Error("The photo is too large to upload even after compression. Retake it.");
  } finally {
    if (rendered !== original) rendered.release();
    original.release();
  }
}

function outboxDirectory(): Directory {
  const directory = new Directory(Paths.document, OUTBOX_DIRECTORY);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

// Moves a processed photo into the outbox and returns its path relative to
// the document directory (stored in the outbox row).
export async function storeOutboxPhoto(sourceUri: string, photoUuid: string): Promise<string> {
  const name = `${photoUuid}.jpg`;
  const destination = new File(outboxDirectory(), name);
  await new File(sourceUri).move(destination);
  return `${OUTBOX_DIRECTORY}/${name}`;
}

function resolve(relativePath: string): File {
  if (!/^outbox\/[0-9a-f-]+\.jpg$/.test(relativePath)) {
    throw new Error("Unexpected outbox photo path.");
  }
  return new File(Paths.document, relativePath);
}

export const outboxPhotoFiles: PhotoFiles = {
  async read(relativePath) {
    return resolve(relativePath).arrayBuffer();
  },
  async remove(relativePath) {
    const file = resolve(relativePath);
    if (file.exists) file.delete();
  },
};
