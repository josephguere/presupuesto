/**
 * Genera el valor de `AUTH_PIN_HASH` a partir de un PIN.
 *
 * Uso:
 *
 *   npm run auth:hash            pide el PIN sin mostrarlo en pantalla
 *   echo 1234 | npm run auth:hash    para automatizar (deja rastro: ver abajo)
 *
 * El PIN **no se pasa por argumento** a propósito: quedaría en el historial de
 * la terminal y en la lista de procesos, visible para cualquier otro programa de
 * la máquina. Se pide por teclado, con el eco apagado, y no se escribe en ningún
 * fichero: lo único que sale por pantalla es el hash, que es lo que hay que
 * copiar.
 *
 * Se pide dos veces. Un hash de un PIN tecleado con un error deja la aplicación
 * inaccesible sin ninguna señal de por qué, así que la confirmación evita el
 * único fallo verdaderamente caro de este script.
 */
import { hashPin, isValidPinFormat } from "../lib/auth/pin";

const PROMPT = "PIN de 4 dígitos: ";
const CONFIRM = "Repite el PIN:    ";

/**
 * Lee una línea sin mostrarla.
 *
 * En una terminal se apaga el eco y se pinta un asterisco por tecla. Si la
 * entrada viene por tubería no hay eco que apagar y se lee tal cual.
 */
function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;

  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      let buffer = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk: string) => {
        buffer += chunk;
      });
      stdin.on("end", () => resolve(buffer.split(/\r?\n/)[0] ?? ""));
    });
  }

  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise((resolve) => {
    let value = "";

    const finish = (result: string) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stdout.write("\n");
      resolve(result);
    };

    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") return finish(value);

        // Ctrl+C: salir sin dejar la terminal en modo crudo.
        if (character === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }

        if (character === "\u007f" || character === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }

        value += character;
        process.stdout.write("*");
      }
    };

    stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  const pin = (await promptHidden(PROMPT)).trim();

  if (!isValidPinFormat(pin)) {
    console.error("\nEl PIN debe tener exactamente 4 dígitos (0-9).");
    process.exit(1);
  }

  if (process.stdin.isTTY) {
    const again = (await promptHidden(CONFIRM)).trim();
    if (again !== pin) {
      console.error("\nLos PIN no coinciden. No se generó nada.");
      process.exit(1);
    }
  }

  const hash = hashPin(pin);

  console.log("\nAñade esta línea a .env.local (y a las variables de Vercel):\n");
  console.log(`AUTH_PIN_HASH=${hash}`);
  console.log("\nY un secreto de sesión, si aún no lo tienes:\n");
  console.log(
    `AUTH_SESSION_SECRET=${Buffer.from(
      crypto.getRandomValues(new Uint8Array(32)),
    ).toString("hex")}`,
  );
  console.log("\nEl PIN no se ha guardado en ningún archivo.");
}

main().catch((error: unknown) => {
  console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
