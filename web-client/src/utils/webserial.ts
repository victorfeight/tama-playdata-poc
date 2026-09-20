import { hasParadiseSerial, requestParadiseSerialPort, WebSerialTransport } from "@tama-breed-poc/tama-protocol";

export async function connectDongle(): Promise<WebSerialTransport> {
  const transport = await requestParadiseSerialPort();
  await transport.open();
  return transport;
}

export { hasParadiseSerial };
