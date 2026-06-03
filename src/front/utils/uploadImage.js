// Limits per-context — change here, applies everywhere.
const LIMITS = {
  profile: { maxSide: 512,  quality: 0.85 },   // avatar pequeño
  event:   { maxSide: 1600, quality: 0.85 },   // portada grande
  chat:    { maxSide: 1280, quality: 0.82 },   // foto en chat
};

// Comprime con canvas y devuelve dataURL base64.
// Maneja archivos hasta ~25 MB (el browser puede leerlos).
// Después de comprimir un iPhone 4MB → ~250 KB.
export const compressImage = (file, kind = "chat") =>
  new Promise((resolve, reject) => {
    const cfg = LIMITS[kind] || LIMITS.chat;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const max = cfg.maxSide;
      if (width > height && width > max) {
        height = Math.round((height * max) / width); width = max;
      } else if (height > max) {
        width = Math.round((width * max) / height); height = max;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", cfg.quality));
    };
    img.onerror = reject;
    img.src = url;
  });

export default compressImage;
