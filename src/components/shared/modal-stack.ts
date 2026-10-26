/** 嵌套素材库/裁剪对话框只允许最上层处理键盘关闭和焦点循环。 */
export class ModalStack {
  private layers: symbol[] = [];
  push(id: symbol) {
    this.layers.push(id);
  }
  remove(id: symbol) {
    const index = this.layers.indexOf(id);
    if (index >= 0) this.layers.splice(index, 1);
  }
  isTop(id: symbol) {
    return this.layers[this.layers.length - 1] === id;
  }
}
