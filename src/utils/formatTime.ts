export function formatElapsedTime(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const seconds = totalSeconds % 60;

  let result = [];
  if (hours > 0) result.push(`${hours} hr`);
  if (minutes > 0) result.push(`${minutes} minutes`);
  if (seconds > 0 || result.length === 0) result.push(`${seconds} seconds`);

  return result.join(" ");
}
