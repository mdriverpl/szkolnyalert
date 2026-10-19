# Serwer z plikiem JSON

Wymagany jest serwer z Node.js 22.12+ (sprawdzono na 24), trwałym lokalnym dyskiem i jedną instancją backendu. PostgreSQL nie jest wymagany. To aplikacja Node.js; hosting obsługujący wyłącznie pliki HTML/PHP nie wystarczy.

Wszystkie szkoły korzystają z jednego prywatnego `app.json`. Backend nadal sprawdza `schoolId` przy odczytach i zmianach. Dane szkół, konta, skróty haseł, sesje, alerty i zaszyfrowane klucze są zapisywane razem, aby zmiana nie rozdzieliła się między kilka plików. Nie należy udostępniać katalogu danych przez serwer WWW ani używać współdzielonego dysku sieciowego dla kilku instancji.

## Konfiguracja i uruchomienie

1. Umieść kod np. w `/opt/szkolnyalert`. Uruchom `npm ci` oraz `npm run build`.
2. Skopiuj `.env.production.example` do `.env` albo, dla dołączonej usługi systemd, do `/etc/szkolnyalert.env`.
3. Ustaw `PUBLIC_APP_URL` na swoją działającą domenę HTTPS i wklej `SMS_ENCRYPTION_KEY`. Przy przenoszeniu istniejących danych koniecznie użyj obecnego klucza z lokalnego `.env`. Dla nowej instalacji wygeneruj go poleceniem podanym w szablonie. Zabezpiecz plik konfiguracji, np. uprawnieniami `0600`.
4. Ustaw prywatny, zapisywalny `DATA_DIR`, np. `/var/lib/szkolnyalert`. Pozostaw `STORAGE_DRIVER=json`, `DEMO_DATA=false` i `JSON_FILE=app.json`.
5. Uruchom `npm start` (konfiguracja z `.env`) lub usługę systemd opisaną poniżej. Przed startem nowa instalacja nie zawiera szkół, kont demo ani aktywnych alarmów. Pierwszą szkołę załóż formularzem **Dodaj szkołę**.
6. Skieruj reverse proxy HTTPS do `127.0.0.1:3001`. Przykład Nginx znajduje się w `nginx.conf.example`; wymaga własnej domeny i istniejącego certyfikatu. Cała strona i API są obsługiwane przez Node.js, a pliki JSON nie są publiczne.

Nie ustawiaj `DEMO_DATA=true` w produkcji — aplikacja odmówi startu. Istniejące pliki są zachowywane; błędny lub pusty JSON zatrzymuje start i nigdy nie zostaje zastąpiony danymi demonstracyjnymi.

## Usługa Linux

Utwórz użytkownika systemowego `szkolnyalert` bez uprawnień administratora. Musi mieć prawo odczytu kodu w `/opt/szkolnyalert`. Skopiuj `szkolnyalert.service` do `/etc/systemd/system/`, a konfigurację do `/etc/szkolnyalert.env`. Zweryfikuj ścieżkę `/usr/bin/node`. Katalog `/var/lib/szkolnyalert` zostanie utworzony przez systemd dla użytkownika usługi.

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now szkolnyalert
sudo systemctl status szkolnyalert
sudo journalctl -u szkolnyalert -n 100
```

Uruchamiaj dokładnie jeden proces backendu: bez klastra Node, wielu replik kontenera lub trybu cluster w PM2. Usługa korzysta z pliku blokady `app.json.lock`, który zawiera PID. Prawidłowe zatrzymanie usuwa blokadę. Po awarii lub utracie zasilania zatrzymaj usługę, upewnij się, że poprzedni proces nie działa, i dopiero wtedy usuń pozostałą blokadę przed ponownym startem. Nie kasuj blokady działającego procesu.

## Kopie zapasowe i odtwarzanie

Zapis jest kolejkowany. Nowy stan trafia najpierw do osobnego pliku, jest synchronizowany z dyskiem i dopiero potem zastępuje plik główny. Każda operacja obejmuje wspólnie wszystkie zmieniane rekordy.

Przed pierwszą zmianą po starcie, a następnie przed zmianą po upływie 60 minut, poprzedni stan jest kopiowany do `DATA_DIR/backups`. Gdy nie ma zmian, kopie nie powstają. Domyślnie pozostaje 48 najnowszych kopii tego magazynu. Parametry: `JSON_BACKUP_INTERVAL_MINUTES` i `JSON_BACKUP_LIMIT`. Błąd utworzenia wymaganej kopii blokuje daną zmianę zamiast nadpisywać stan bez kopii.

Kopie na tym samym dysku nie chronią przed utratą serwera. Zaplanuj dodatkowe, szyfrowane kopiowanie poza serwer i zachowaj osobno bezpieczną kopię `.env` z kluczem szyfrowania. Kopie zawierają dane osobowe i skróty sesji — traktuj je tak samo jak plik główny.

Aby odtworzyć stan: zatrzymaj usługę, zachowaj aktualny plik, sprawdź poprawność wybranej kopii JSON i skopiuj ją pod ścieżkę `DATA_DIR/JSON_FILE`. Przywróć właściciela `szkolnyalert` i uprawnienia `0600`, zachowaj właściwy klucz szyfrowania i uruchom usługę. Odtworzenie starej kopii przywraca również zawarte w niej sesje i linki; unieważnij dostępy, które po dacie kopii były cofnięte.

## Przeniesienie obecnych danych lokalnych

Zatrzymaj lokalny backend. Skopiuj `data/demo.json` na serwer jako `/var/lib/szkolnyalert/app.json`, a obecną wartość `SMS_ENCRYPTION_KEY` do konfiguracji produkcyjnej. Kopia obejmuje wszystkie obecne szkoły i użytkowników, również przykładowych — przejrzyj i usuń niepotrzebne konta przed udostępnieniem serwera. Nazwa `demo.json` nie zmienia formatu danych. Nowe instalacje bez skopiowanego pliku zaczynają od pustego magazynu.

Nie kopiuj pliku `.lock` ani plików `.tmp`. Nie usuwaj lokalnych danych po przeniesieniu, dopóki nie sprawdzisz logowania, uprawnień, osobistych linków, restartu i odtwarzania kopii na serwerze.

Ta konfiguracja nie publikuje automatycznie aplikacji w Internecie. Do wdrożenia potrzebne są dostęp do serwera i skonfigurowana domena HTTPS.
