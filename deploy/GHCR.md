# Obraz Docker w GitHub Container Registry

Workflow `.github/workflows/container.yml` działa po pushu na `main` oraz po ręcznym uruchomieniu w zakładce Actions. Publikuje obrazy dla `linux/amd64` i `linux/arm64`:

```text
ghcr.io/mdriverpl/szkolnyalert:latest
ghcr.io/mdriverpl/szkolnyalert:sha-PEŁNY_SHA_COMMITA
```

Przed publikacją muszą przejść testy aplikacji, build i uruchomienie kontenera z zapisem JSON oraz restartem. Pull requesty wykonują sprawdzenia i budują obraz testowy, ale nie publikują go. Workflow używa automatycznego `GITHUB_TOKEN` z uprawnieniem `packages: write`; nie wymaga serwera SSH ani dodatkowego sekretu do publikacji. [Dokumentacja GitHub dotycząca publikowania obrazów](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images).

Status i logi: https://github.com/mdriverpl/szkolnyalert/actions

Pakiet: https://github.com/users/mdriverpl/packages/container/package/szkolnyalert

## Uruchomienie obrazu

Na serwerze z Docker Engine i Docker Compose umieść `compose.app.yaml` oraz prywatny plik `.env.server`. Wzorem konfiguracji jest `.env.production.example`. Ustaw faktyczny publiczny `PUBLIC_APP_URL` z HTTPS oraz trwały `SMS_ENCRYPTION_KEY` (ten sam przy przenoszeniu istniejących danych). Compose nie włącza bazy PostgreSQL.

Domyślny `compose.yaml` zawiera tę samą aplikację co `compose.app.yaml`, więc panele używające automatycznie `compose.yaml` również uruchomią obraz GHCR i mapowanie host `8080` → kontener `3001`. Opcjonalny PostgreSQL został przeniesiony do `compose.postgres.yaml`.

```sh
docker compose --env-file .env.server -f compose.app.yaml pull
docker compose --env-file .env.server -f compose.app.yaml up -d
docker compose --env-file .env.server -f compose.app.yaml logs -f app
```

W Compose konfiguracja JSON jest wymuszona: produkcja, bez kont demo, `/data/app.json` i kopie w `/data/backups`. Pierwsza instalacja ma pusty magazyn. Załóż szkołę formularzem **Dodaj szkołę**.

Plik `.env.server` nie jest automatycznie ładowany przez Docker Compose bez `--env-file`. Nie przesyłaj go do GitHub. Na serwerze aplikacja jest dostępna pod `http://127.0.0.1:8080/`, a wewnątrz kontenera nadal na porcie `3001`. Mapowanie to `127.0.0.1:8080:3001`; port hosta można zmienić zmienną `HOST_PORT`. Monitoring hostingu powinien sprawdzać `http://127.0.0.1:8080/api/health` lub stronę główną na tym samym porcie.

Postaw przed kontenerem Nginx HTTPS według `deploy/nginx.conf.example`, zmieniając `proxy_pass` z portu `3001` (instalacja natywna) na `http://127.0.0.1:8080` (Docker). Kontener nasłuchuje na `0.0.0.0`, działa jako użytkownik `node`, ma pliki aplikacji tylko do odczytu i zapisuje dane w osobnym wolumenie. Status `healthy` kontenera przy niedostępności portu hosta zwykle oznacza błędne mapowanie portów lub adres upstream proxy; restart kontenera nie poprawia konfiguracji mapowania.

Połączenie hostowego Nginx z kontenerem przechodzi przez prywatny most Dockera, dlatego Compose ustawia `TRUST_PROXY=loopback,linklocal,uniquelocal`. Ta konfiguracja zakłada, że port kontenera pozostaje przypięty do `127.0.0.1`. Nie wystawiaj go bezpośrednio do Internetu. Jeśli reverse proxy jest na innym serwerze lub w innej sieci, ustaw `TRUST_PROXY` na konkretne zaufane adresy/CIDR; proxy musi nadpisywać `Host` i `X-Forwarded-Proto`.

## Aktualizacje i dane

Ponowne `pull` i `up -d` aktualizuje kontener i zachowuje nazwany wolumen `app_data` (Docker dodaje do jego nazwy prefiks projektu Compose). Nie zmieniaj nazwy projektu przy aktualizacji. Nie uruchamiaj więcej niż jednej repliki aplikacji na tym wolumenie. Nie używaj `docker compose down -v`, ponieważ usuwa dane.

Kopie na tym samym wolumenie nie zastępują kopii poza serwerem. Zachowaj kopię plików z `/data` i osobno klucza szyfrowania. Przy przenoszeniu obecnego `data/demo.json` zatrzymaj aplikację i skopiuj go do wolumenu pod nazwą `app.json`, z właścicielem UID/GID `1000:1000` i uprawnieniami `0600`. Zachowaj obecny `SMS_ENCRYPTION_KEY`; przejrzyj również ewentualne konta demonstracyjne w przenoszonych danych.

Do konkretnej wersji można wrócić, ustawiając `IMAGE_TAG=sha-PEŁNY_SHA_COMMITA` w pliku `.env.server` i powtarzając `pull` oraz `up -d`. Dotyczy to kodu; dane JSON nie są cofane. Po awarii blokadę `app.json.lock` wolno usunąć dopiero po upewnieniu się, że poprzedni kontener nie działa.

## Dostęp do obrazu

Nowy pakiet GHCR może być prywatny. W takim przypadku zaloguj serwer do `ghcr.io` przy użyciu konta z dostępem do pakietu i tokenu z uprawnieniem odczytu pakietów, podając token przez `docker login --password-stdin`. Jeśli obraz ma być dostępny bez logowania, właściciel repozytorium może zmienić widoczność pakietu na publiczną w jego ustawieniach.

Jeśli publikacja nie powiedzie się z powodu uprawnień, sprawdź dostęp workflow do GitHub Packages oraz powiązanie istniejącego pakietu z repozytorium. Nie dodawaj osobistych tokenów ani kluczy szyfrowania do Dockerfile.

## Build lokalny

```sh
docker build -t szkolnyalert:test .
bash scripts/container-smoke.sh
```

Obraz nie zawiera `.env`, lokalnego `data`, `.git`, kopii zapasowych ani kluczy. `.dockerignore` wpuszcza tylko wskazane pliki źródłowe; etap końcowy zawiera zależności produkcyjne, backend i wynik builda frontendu.
