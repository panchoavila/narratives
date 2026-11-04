# Canvas

Proyecto real de Revyme en `sites/canvas`. Abrir en el editor habitual:

http://localhost:3333/builder/canvas

Las páginas `app/page.client.tsx` y `app/espacio/page.client.tsx` contienen los nodos editables. Sus bloques `@canvas` declaran Desktop (1200), Tablet (700) y Mobile (390); sus estilos responsive viven en cada página.

El botón del extremo derecho de la toolbar alterna el mismo canvas de edición entre 2D e isométrico vertical. Todos sus viewports por breakpoint y sus encabezados transicionan en un plano común; los elementos internos se separan por profundidad. El icono usa el botón y los colores del tema de Revyme. No hay ventana ni panel adicional.

Pan y zoom siguen usando la cámara existente. Esc o el mismo botón devuelven el canvas a 2D y restauran la herramienta anterior. El cambio de vista conserva los nodos y no modifica los archivos del proyecto.

Seleccionar el viewport permite editar Animation → Page → Displacement: duración, intensidad, semilla y columnas. El efecto también está disponible al añadir Page Transition desde Animation.

`app/page-effects.ts` conserva el efecto; `app/page-transitions.tsx` lo reproduce al navegar entre páginas en Preview. El runtime incluye fallback de navegación normal ante movimiento reducido, captura incompatible o GPU no disponible. La exportación de código incluye el runtime local bajo `vendor/revyme-runtime`.

Se comprobó el recorrido toolbar real → Comlink → sandbox → renderer, conservando los tres viewports, sus encabezados, los nodos y la cámara al volver a 2D. Evidencia actual: `research/2026-11-04-canvas-upright` en Websites. Los controles de Displacement, persistencia y Preview se comprobaron anteriormente en `research/2026-11-04-canvas-flow-audit`. La apariencia final y reproducción GPU no se verificaron: no se usó navegador ni pantalla. No hubo despliegue.
