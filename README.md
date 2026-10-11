# Atelier Corte

Aplicación web para guardar telas, crear presets de productos de costura y calcular layouts de corte 2D.

## Requisitos

- Node.js 20.19+ o 22.12+
- npm o pnpm

## Ejecutar en desarrollo

```bash
npm install
npm run dev
```

Vite mostrará una URL local. Ábrela en un navegador de escritorio o móvil conectado a la misma red.

## Crear la versión de producción

```bash
npm run build
npm run preview
```

Los archivos listos para publicar quedan en `dist/`.

## Funciones incluidas

- Biblioteca de telas, anchos útiles, costo por metro, dirección de tela y muestras de color.
- Productos con piezas, formas, tallas, medidas, márgenes globales o por pieza y materiales por talla.
- Duplicación de talla con factor de escala.
- Pedido de producción, cálculo de piezas y agrupación por tela y color.
- Acomodo 2D MaxRects con rotación condicionada por la dirección de la tela, ajuste manual y validación de cruces.
- Exportación de lista CSV, layout SVG/PNG e impresión a PDF desde el navegador.
- Vista 3D paramétrica y carga local de modelos `.glb`, `.gltf` u `.obj` con asignación de materiales.
- Guardado automático en `localStorage` y respaldo/restauración JSON.
- Sincronización opcional con una hoja privada de Google Sheets, con autorización OAuth, comparación de versiones y copia local de recuperación.

## Google Sheets

Consulta `public/guia-google-sheets.html` o abre `/guia-google-sheets.html` en la aplicación publicada. Sube la plantilla XLSX a Drive y conviértela en una hoja nativa. Configura un cliente OAuth web con Sheets API habilitada y el origen de la aplicación autorizado. En el botón de configuración de la barra superior, introduce el ID de cliente y el enlace de la hoja.

En el dispositivo que ya tiene los datos, elige **Subir datos de este dispositivo**. En el segundo, elige **Usar los datos de la hoja**. La migración nunca reemplaza información diferente sin que el usuario elija una versión. El guardado local y el formato de respaldo JSON se conservan.

Los tokens de Google solo están en memoria. Hay que reconectar al abrir una sesión o vencer el token. Los cambios se envían tras 1.8 segundos sin editar y se consultan cada 30 segundos mientras la app está visible. Se comparan hashes antes y después de escribir. Sheets no ofrece compare-and-swap en esta integración: usa un dispositivo de edición a la vez. El envío de todas las pestañas es un único `batchUpdate`; solo modifica valores en las columnas administradas y conserva formato y pestañas adicionales.

La sincronización incluye telas, colores, presets, tallas, piezas, medidas, materiales por talla, miniaturas, unidad, separación y pedido actual. El corte sigue recalculándose como antes; el acomodo temporal manual y los modelos 3D importados conservan su comportamiento previo.

El nesting usa una heurística MaxRects (best-short-side-fit), que calcula un acomodo práctico con rapidez; el resultado es una estimación y conviene revisar el layout antes de marcar la tela. La vista 3D es una previsualización dimensional y no sustituye un patrón de confección. Para importar un modelo con texturas incluidas, usa GLB.

## Datos de ejemplo

La primera apertura incluye la cama redonda “Cama Nube”, tres tallas, tres piezas, dos telas, cuatro colores y un pedido de prueba. Los datos se pueden editar o restaurar desde un respaldo JSON.
