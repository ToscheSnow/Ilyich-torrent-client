num = input("Enter your favourite number: ")

bEncodedInt = "69" + "".join(f"{ord(c):02x}" for c in num) + "65"

with open("test", "wb") as f:
    f.write(bytes.fromhex(bEncodedInt))
