#!/usr/bin/env python3

from mnemonic import Mnemonic


def generate_mnemonics(count, output_file):
    mnemo = Mnemonic("english")
    with open(output_file, "w") as f:
        for _ in range(count):
            f.write(mnemo.generate(strength=128) + "\n")


if __name__ == "__main__":
    import sys

    output_file = sys.argv[1] if len(sys.argv) > 1 else "mnemonics.txt"
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 100
    generate_mnemonics(count, output_file)
    print(f"Generated {count} valid mnemonics and saved to {output_file}")
