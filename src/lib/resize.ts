// Browser-side: downscale a photo and return plain base64 JPEG (no data: prefix).
// Keeps uploads small and Gemma fast. Use before POST /api/analyze.
export async function fileToBase64Jpeg(file: File, maxSide = 1600, quality = 0.85): Promise<string> {
	const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(bitmap.width * scale);
	canvas.height = Math.round(bitmap.height * scale);
	canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	return canvas.toDataURL('image/jpeg', quality).split(',')[1];
}
