class DiagChannel {
  public name: string;
  public hasSubscribes: boolean = false;

  constructor(name: string) {
    this.name = name;
  }

  publish(message: any) {
    // noop
  }
}

export function channel(name: string) {
  return new DiagChannel(name);
}
