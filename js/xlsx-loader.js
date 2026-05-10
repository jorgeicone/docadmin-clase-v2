// Lazy loader de xlsx.full.min.js (270 KiB).
// Antes se cargaba en cada visita; ahora solo cuando el usuario importa o exporta Excel.
// Cachea el resultado: la segunda llamada es instantánea.
let xlsxPromise = null;

export function loadXLSX(){
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxPromise) return xlsxPromise;
  xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => {
      xlsxPromise = null;
      reject(new Error('No se pudo cargar XLSX desde CDN. Verifica tu conexión.'));
    };
    document.head.appendChild(s);
  });
  return xlsxPromise;
}
