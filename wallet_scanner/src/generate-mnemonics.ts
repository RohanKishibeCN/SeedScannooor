import fs from "node:fs";
import process from "node:process";
import bip39 from "bip39";

const outputFile = process.argv[2] ?? "mnemonics.txt";

const cliCount = process.argv[3];
const envCount = process.env.MNEMONICS_COUNT;
const count = Number.parseInt(cliCount ?? envCount ?? "2000", 10);

if (!Number.isFinite(count) || count <= 0) {
  process.stderr.write(`Invalid count: ${process.argv[3]}\n`);
  process.exitCode = 1;
} else {
  const lines: string[] = [];
  for (let i = 0; i < count; i += 1) {
    lines.push(bip39.generateMnemonic(128));
  }

  fs.writeFileSync(outputFile, lines.join("\n") + "\n", "utf-8");
  process.stdout.write(`Generated ${count} valid mnemonics and saved to ${outputFile}\n`);
}

