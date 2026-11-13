"""Печатает строку для EDITOR_PASSWORD_HASH. Пароль не попадает в историю команд.

    python -m app.editor.hash_password
    echo "пароль" | python -m app.editor.hash_password --stdin
"""

import getpass
import sys

from app.editor.security import hash_password


def main() -> None:
    if "--stdin" in sys.argv:
        password = sys.stdin.readline().rstrip("\r\n")
    else:
        password = getpass.getpass("Пароль редактора: ")
        if getpass.getpass("Повторите пароль: ") != password:
            sys.exit("Пароли не совпадают")
    if len(password) < 8:
        sys.exit("Пароль должен быть не короче 8 символов")
    print(hash_password(password))


if __name__ == "__main__":
    main()
