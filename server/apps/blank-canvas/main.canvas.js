function render(ctx, state) {
  ctx.clear('#000000');
  ctx.fillStyle = '#40e0ff';
  ctx.fillRect(state.frame % 152, 56, 8, 16);
}
