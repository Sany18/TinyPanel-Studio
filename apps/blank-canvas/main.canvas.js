/**
 * @tinypanel
 * @name Blank Canvas
 * @description Starter app for experiments
 * @width 160
 * @height 128
 * @orientation landscape
 * @fps 30
 */
function render(ctx, state) {
  ctx.clear('#000000');
  ctx.fillStyle = '#40e0ff';
  ctx.fillRect(state.frame % 152, 56, 8, 16);
}
