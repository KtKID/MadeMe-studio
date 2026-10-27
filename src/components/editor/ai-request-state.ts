/** 关闭或重开 AI 面板后，旧请求不得向新的编辑会话写回建议。 */
export class AIRequestState {
  private generation = 0;
  invalidate() {
    this.generation += 1;
  }
  snapshot() {
    return this.generation;
  }
  isCurrent(generation: number) {
    return generation === this.generation;
  }
}
