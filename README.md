# Szkolny Alert

Vue 3 + Vite, backend Express / Node.js, PostgreSQL. Interfejs w języku polskim, responsywny panel z manifestem PWA.

## Uruchomienie

Node.js 22.12+ (sprawdzono na 24).

```powershell
npm.cmd install --cache .npm-cache
npm.cmd run dev
```

Otwórz adres wypisany przez Vite (zwykle http://127.0.0.1:5173). Backend działa na porcie 3001. Bez `DATABASE_URL` aplikacja korzysta z przykładowych danych zapisywanych w `data/demo.json`. Nie używaj demo do rzeczywistych danych.

## Jedno konto — jedna szkoła

Każdy użytkownik ma jedno `schoolId`. Po zalogowaniu backend zwraca wyłącznie jego szkołę, jej nauczycieli, procedury, alerty i historię zdarzeń. Nie ma wspólnej listy szkół ani przełączania placówek. Każde żądanie zapisu jest sprawdzane względem szkoły z sesji, także przy ręcznej zmianie identyfikatora w API. Logowania nie można wyłączyć zmienną `AUTH_REQUIRED`.

- **Administrator szkoły** zarządza danymi swojej szkoły i jej kontami użytkowników. Może uruchamiać i kończyć alerty.
- **Nauczyciel** czyta dane własnej szkoły i może uruchomić alert. Nie zarządza kontami ani katalogami i nie kończy zdarzeń.

Katalog „Nauczyciele” zawiera dane kontaktowe. Konto z hasłem tworzy się osobno w zakładce **Użytkownicy → Dodaj użytkownika**. Konto jest automatycznie przypisane do szkoły zalogowanego administratora. Nie można usunąć ani zdegradować ostatniego administratora placówki.

Przy dodawaniu lub edycji użytkownika oraz nauczyciela można uzupełnić opcjonalny **numer telefonu**. Numer jest widoczny na odpowiedniej liście i można go kliknąć, aby zadzwonić. Akceptowane są numery z 7–15 cyframi, opcjonalnym `+`, spacjami, nawiasami i myślnikami. Formularz dodania szkoły nadal ma trzy pola.

### Import nauczycieli z CSV

Administrator wybiera **Nauczyciele → Import CSV**, wskazuje plik i sprawdza podgląd, a następnie zatwierdza import. W oknie dostępny jest **Pobierz wzór CSV**. Kolumny: `imię i nazwisko`, `email`, `przedmiot`, opcjonalnie `telefon`. Obsługiwane są też osobne kolumny `imię` i `nazwisko`, angielskie nazwy `name`, `email`, `subject`, `phone` oraz separatory `;`, `,` i tabulator. Kodowanie UTF-8 (także BOM) lub Windows-1250 można wybrać w oknie importu.

Limit wynosi 500 nauczycieli i 512 KB. Każdy wiersz przechodzi tę samą walidację co ręczne dodawanie. Błędny wiersz blokuje cały zapis. Powtarzające się adresy e-mail w szkole lub w pliku są pomijane; istniejące dane nie są nadpisywane. Przy zatwierdzeniu backend ponownie sprawdza dane w transakcji. Szkoła jest zawsze pobierana z sesji — plik nie może wskazać innej szkoły. Import tworzy wpisy w katalogu nauczycieli, nie konta logowania.

### Bramka SMSAPI

Administrator otwiera **Ustawienia → Bramka SMSAPI**, wkleja token OAuth z konta SMSAPI i opcjonalnie podaje zatwierdzoną nazwę nadawcy (do 11 znaków). Puste pole tokenu przy kolejnym zapisie zachowuje dotychczasowy token. Przycisk usunięcia tokenu wyłącza automatyczne SMS-y. Nie wpisuj tokenu do repozytorium ani do kodu frontendu.

Domyślnie **tryb testowy jest włączony**, a automatyczna wysyłka alertów jest wyłączona. Zapisz konfigurację, podaj numer testowy i kliknij **Sprawdź API bez wysyłki**. W tym trybie backend dodaje `test=1`, więc SMS nie jest dostarczany. Wyłączenie trybu testowego oznacza rzeczywistą, płatną wysyłkę, także dla przycisku SMS-a testowego. Długa treść może wymagać kilku płatnych części.

Po włączeniu automatycznych SMS-ów uruchomienie alertu wysyła komunikat do unikalnych, poprawnych numerów z katalogu **Nauczyciele** tej jednej szkoły. Numery krajowe z 9 cyframi otrzymują prefiks `48`; numery zagraniczne należy podać z prefiksem kraju. Konta użytkowników nie są dodatkowym źródłem odbiorców. Stare zdarzenia nie są wysyłane ponownie po włączeniu bramki.

Integracja korzysta z `POST https://api.smsapi.pl/sms.do`, autoryzacji Bearer i pól formularza `to`, `message`, opcjonalnie `from`, `test`, `format=json`, zgodnie z [dokumentacją SMSAPI](https://www.smsapi.pl/docs). Przyjęcie przez bramkę nie jest potwierdzeniem doręczenia. Historia zdarzeń pokazuje wynik przyjęcia, błędy i częściową akceptację; raporty doręczenia sprawdzaj w panelu SMSAPI. Callbacki doręczeń nie są jeszcze podłączone.

Tokeny są szyfrowane AES-256-GCM z powiązaniem do szkoły. Lokalny tryb demo automatycznie tworzy klucz w `data/sms-encryption.key`. Zachowaj go wraz z kopią danych. Dla PostgreSQL i produkcji ustaw `SMS_ENCRYPTION_KEY` (32 losowe bajty jako base64, przykład generowania w `.env.example`); wszystkie instancje wymagają tego samego klucza. Zmiana lub utrata klucza wymaga ponownego zapisania tokenów. API zwraca wyłącznie informację, czy token jest zapisany.

Próba wysyłki jest oznaczana w danych przed wywołaniem SMSAPI. Nie ma automatycznego ponawiania, aby nie wysyłać duplikatów po timeoutach. Jeśli wynik jest nieznany albo restart przerwał wysyłkę, sprawdź panel operatora. Błąd SMSAPI nie usuwa uruchomionego alertu. Wysyłka wymaga własnego tokenu, zatwierdzonego nadawcy, uprawnień API oraz środków na koncie; testy projektu używają atrap operatora i nie wysyłają rzeczywistych SMS-ów.

### Dodanie nowej szkoły

Na ekranie startowym kliknij **Dodaj szkołę**, bez wcześniejszego logowania. Formularz ma trzy pola: **nazwa szkoły**, **nazwa użytkownika** i **hasło** (11–128 znaków). Nazwa użytkownika ma 3–80 znaków, bez spacji, i jest unikalna bez względu na wielkość liter. To login pierwszego administratora tej szkoły. Po zapisaniu otworzy się panel wyłącznie nowej placówki. Miejscowość, adres i dane kontaktowe można uzupełnić później. Rejestracja nigdy nie nadaje dostępu do istniejącej szkoły.

### Konta demonstracyjne

| Konto | Szkoła | Rola |
| --- | --- | --- |
| `admin@szkolnyalert.pl` | Szkoła Podstawowa nr 12 | Administrator |
| `admin2@szkolnyalert.pl` | Liceum Ogólnokształcące nr 3 | Administrator |
| `nauczyciel@szkolnyalert.pl` | Szkoła Podstawowa nr 12 | Nauczyciel |

Hasło wszystkich kont demo: `demo12345`. Skrócone hasło dotyczy tylko przygotowanych kont przykładowych; nowe konta wymagają minimum 11 znaków. Konta demo nie są wyświetlane na ekranie logowania; aby z nich skorzystać, wpisz e-mail i hasło w formularzu.

Hasła są przechowywane jako skróty scrypt z losową solą. API nigdy nie zwraca skrótów haseł. Sesja HTTP-only / SameSite=Strict trwa 8 godzin i przeżywa restart backendu. Sesje są zapisywane w tym samym magazynie co dane aplikacji (plik demo albo PostgreSQL); przechowywany jest skrót SHA-256 tokenu, nie sam token cookie. Wylogowanie usuwa sesję trwale. Usunięcie konta lub zmiana hasła, nazwy użytkownika, e-maila albo roli unieważnia jego sesje.

## PostgreSQL

1. Skopiuj `.env.example` do `.env`.
2. Ustaw `POSTGRES_PASSWORD` i `DATABASE_URL` z tym samym hasłem.
3. Uruchom PostgreSQL lokalnie lub `docker compose up -d db`, jeżeli masz Docker Desktop.
4. Uruchom aplikację i użyj formularza **Dodaj szkołę**, aby utworzyć pierwszą placówkę i administratora.

Przykładowy URL: `postgresql://szkolnyalert:TWOJE_HASLO@localhost:5432/szkolnyalert`. Znaki specjalne hasła należy zakodować w URL. Nowa baza jest pusta; nie są do niej importowane konta demo.

Dane MVP są dokumentem JSONB w tabeli `school_app_state`. Transakcje `SELECT FOR UPDATE` serializują zapis. Docelowe skalowanie wymaga wydzielonych tabel i indeksów. Izolacja szkół jest egzekwowana przez API; PostgreSQL nie ma jeszcze osobnych polityk RLS.

Stare dane bez tablicy `users` są uzupełniane bez usuwania rekordów. W demo konta są przypisywane tylko do znanych szkół `school-demo` i `school-demo-2`. Inne starsze szkoły wymagają przypisania administratora lokalnym narzędziem poniżej; nie są automatycznie udostępniane nowym rejestracjom.

### Konto dla istniejącej szkoły bez administratora

```powershell
$env:SCHOOL_ADMIN_PASSWORD = 'wlasne-dlugie-haslo'
node scripts/create-school-admin.js ID_SZKOLY admin@szkola.pl "Jan Kowalski"
Remove-Item Env:SCHOOL_ADMIN_PASSWORD
```

Wyłącz serwer przed użyciem tego narzędzia z plikiem demo, potem uruchom ponownie. Narzędzie dodaje konto tylko do wskazanej istniejącej szkoły i nie zmienia danych innych szkół. Dla PostgreSQL korzysta z tego samego `.env` co aplikacja.

## Funkcje i weryfikacja

- Szkoła, katalog nauczycieli, konta użytkowników i role.
- Przykładowe procedury: ewakuacja, osoba nieuprawniona w szkole, brak ucznia podczas zajęć, awaria infrastruktury, zgłoszenie przemocy rówieśniczej i komunikat organizacyjny. Dodawane jednorazowo do istniejących i nowo tworzonych szkół, bez nadpisywania ich własnych instrukcji. To szablony do dostosowania i zatwierdzenia przez dyrekcję.
- Alerty powiązane z procedurą tej samej szkoły.
- Przykładowe alerty: alarm pożarowy, osoba nieuprawniona, brak ucznia, awaria zasilania, zgłoszenie przemocy i zmiana organizacji zajęć. Każdy ma priorytet i procedurę tej szkoły. Dodawane jednorazowo, bez uruchamiania zdarzeń i nadpisywania własnych alertów.
- Uruchamianie alertu z lokalizacją, historia i kończenie zdarzeń.
- Kopia procedury w historii, niezależna od późniejszych edycji.
- Odświeżanie panelu co 15 sekund i opcjonalna bramka SMSAPI per szkoła. E-mail i push nie są jeszcze podłączone.

```powershell
npm.cmd test
npm.cmd run build
npm.cmd start
```

Testy obejmują rejestrację szkoły, indywidualne konta i role, blokowanie odczytu i zmian danych innej szkoły, unieważnianie sesji, ochronę ostatniego administratora oraz przepływ rejestracji i logowania w interfejsie. Testy używają magazynu w pamięci; osobne uruchomienie PostgreSQL wymaga weryfikacji środowiska bazy.

Po buildzie frontend i API działają pod http://127.0.0.1:3001. Serwer nasłuchuje lokalnie i nie jest automatycznie publikowany. Wdrożenie wymaga HTTPS i `NODE_ENV=production`. Przy wielu instancjach wszystkie korzystają z tej samej bazy PostgreSQL, także do zapisu sesji; lokalny plik demo jest przeznaczony dla jednej instancji.

## Android i iOS

Interfejs działa w przeglądarce mobilnej. Po udostępnieniu przez HTTPS można dodać go do ekranu początkowego jako PWA (Android: menu przeglądarki; iOS: Safari → Udostępnij → Do ekranu początkowego). Projekt nie zawiera pakietów App Store / Google Play.

### Osobisty panel nauczyciela

1. Administrator otwiera **Nauczyciele** i klika ikonę linku przy wybranej osobie.
2. Wybiera **Wygeneruj link i klucz**, kopiuje link i przekazuje go bezpośrednio właściwemu nauczycielowi. Link jest generowany z adresu, pod którym administrator otworzył aplikację — do udostępniania poza komputerem użyj publicznego adresu HTTPS.
3. Nauczyciel otwiera link `/nauczyciel#klucz=…` lub wpisuje klucz na stronie `/nauczyciel`. Nie otrzymuje dostępu do panelu administracyjnego ani listy kontaktów.
4. Panel pokazuje imię i nazwisko, szkołę, duży przycisk **URUCHOM ALERT** oraz aktywne zdarzenia. Każde aktywne zdarzenie ma od razu widoczną pełną procedurę bezpieczeństwa. Uruchomienie wymaga wyboru alertu i podania miejsca zdarzenia.
5. W otwartym panelu dane odświeżają się co 3 sekundy oraz po powrocie do aplikacji. Po uruchomieniu własnego alertu procedura pojawia się od razu; wysyłka SMS jest obsługiwana niezależnie i nie opóźnia odpowiedzi panelu nauczyciela. Alarm kończy administrator.

Każdy nauczyciel ma własny losowy klucz 256-bitowy. Serwer przechowuje tylko jego skrót SHA-256. Klucz jest pokazywany administratorowi tylko po wygenerowaniu, znajduje się we fragmencie URL (nie w ścieżce ani query string) i po wymianie na sesję jest usuwany z paska adresu. Sesja nauczyciela ma oddzielne cookie HTTP-only/SameSite i trwa 30 dni; przeżywa restart backendu. Nie zastępuje sesji administratora, więc podgląd panelu nie wylogowuje administratora. Wygenerowanie nowego klucza, unieważnienie linku lub usunięcie nauczyciela natychmiast odcina poprzedni dostęp i sesje. Uprawnienia są zawsze ograniczone do szkoły przypisanej nauczycielowi.

Sam link jest kluczem dostępu — nie publikuj go w repozytorium ani nie przekazuj innym osobom. Kopię linku zachowuje odbiorca; po zamknięciu okna administrator generuje nowy klucz, jeżeli potrzebuje ponownie udostępnić dostęp.

### Instalacja i brak połączenia

Panel nauczyciela ma przycisk **Zainstaluj aplikację**, własny manifest `teacher.webmanifest` i startuje jako osobna PWA pod `/nauczyciel`. Jeżeli przeglądarka nie udostępnia systemowego okna instalacji, wyświetlane są instrukcje dla Androida i iOS. Na telefonie wymagany jest dostępny adres HTTPS; `127.0.0.1` wskazuje samo urządzenie i służy do testów na komputerze.

Build generuje wersjonowany service worker `dist/sw.js` z listą rzeczywistych plików JS/CSS oraz ikon. W trybie developerskim service worker nie jest rejestrowany. Aby sprawdzić pełną wersję PWA, uruchom `npm.cmd run build` i otwórz aplikację udostępnianą przez backend pod http://127.0.0.1:3001/nauczyciel.

Service worker przechowuje wyłącznie pliki interfejsu. Nie buforuje API, kluczy, sesji, danych szkoły ani stanów alertów. Bez sieci aplikacja może otworzyć interfejs, lecz nie potwierdza aktualnego stanu zagrożeń i blokuje uruchamianie alertów. Jeśli panel był już otwarty, ostatnia procedura pozostaje widoczna z ostrzeżeniem o nieaktualności. Po ponownym uruchomieniu offline dane szkoły nie są odtwarzane z pamięci podręcznej. Powiadomienia push przy zamkniętej aplikacji nie są jeszcze zaimplementowane; niezależnym kanałem jest skonfigurowana bramka SMSAPI.

Przy wdrożeniu za lokalnym reverse proxy aplikacja ufa nagłówkom proxy tylko z loopback. Proxy musi przekazywać oryginalny `Host` i `X-Forwarded-Proto: https`, aby poprawnie działała kontrola źródła żądań i bezpieczne cookies.
