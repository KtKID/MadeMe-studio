/** 媒体写入采用同步单飞锁，不能只依赖下一次 React render 的 disabled。 */
export class MediaOperation {
  private running = false;
  get busy() {
    return this.running;
  }
  begin() {
    if (this.running) return false;
    this.running = true;
    return true;
  }
  end() {
    this.running = false;
  }
}
