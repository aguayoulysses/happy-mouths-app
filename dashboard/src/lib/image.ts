// Phone photos are 5 to 12 MB. Shrink to a sane JPEG before upload so it fits
// the server's body limit, sends fast on cell data, and Google accepts it.

export async function shrink(file: Blob, maxSide = 2048, quality = 0.85): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const out = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", quality));
    return out ?? file;
  } catch {
    return file;
  }
}
