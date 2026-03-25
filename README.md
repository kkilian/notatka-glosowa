# Notatka Głosowa

Aplikacja do nagrywania mowy i transkrypcji na tekst za pomocą OpenAI Whisper.

## Instalacja

Jedno polecenie:

```bash
curl -fsSL https://raw.githubusercontent.com/kkilian/notatka-glosowa/main/install.sh | bash
```

Automatycznie: klonuje, buduje, instaluje do `/Applications`, dodaje do Docka i uruchamia.

Przy pierwszym uruchomieniu wklej swój klucz API OpenAI. Klucz zostanie zaszyfrowany i zapisany lokalnie (macOS Keychain).

## Wymagania

- macOS 11+
- Node.js 18+

## Rozwój

```bash
npm install
npm start
```
