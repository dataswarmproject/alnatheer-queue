export async function waitForHostExit(
  isAlive: () => Promise<boolean>,
  delay: (ms: number) => Promise<void>,
  attempts = 30,
) {
  for (let i = 0; i < attempts; i++) {
    if (!(await isAlive())) return;
    await delay(1000);
  }
  throw new Error('خادم الفرع لم يخرج بالكامل. أُلغيت عملية التثبيت.');
}
