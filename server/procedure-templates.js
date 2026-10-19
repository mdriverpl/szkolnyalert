import { randomUUID } from 'node:crypto';

const description = 'PRZYKŁADOWY SZABLON — do dostosowania do warunków placówki i zatwierdzenia przez dyrekcję przed użyciem.';
export const procedureTemplates = [
  {
    key: 'evacuation', name: 'Ewakuacja budynku', category: 'Ewakuacja',
    steps: [
      'Po otrzymaniu polecenia ewakuacji przekaż klasie spokojny, jednoznaczny komunikat.',
      'Postępuj według zatwierdzonego planu ewakuacji swojej szkoły i poleceń koordynatora.',
      'Zapewnij przewidziane w planie wsparcie osobom wymagającym pomocy.',
      'W wyznaczonym miejscu zbiórki sprawdź obecność uczniów.',
      'Przekaż koordynatorowi stan grupy oraz informacje o brakujących osobach.',
      'Czekaj z grupą na dalsze polecenia; powrót do budynku wymaga decyzji osoby kierującej działaniami.'
    ]
  },
  {
    key: 'unknown-person', name: 'Osoba nieuprawniona na terenie szkoły', category: 'Bezpieczeństwo',
    steps: [
      'Przekaż dyrekcji lub wyznaczonemu pracownikowi informację o miejscu i charakterze zdarzenia.',
      'Zadbaj o opiekę nad swoją grupą zgodnie ze szkolnymi zasadami bezpieczeństwa.',
      'Nie podejmuj działań, które mogłyby narazić uczniów lub pracowników.',
      'Wykonuj polecenia koordynatora oraz wezwanych służb.',
      'Po zakończeniu zdarzenia sporządź rzeczową notatkę i przekaż ją osobie odpowiedzialnej.'
    ]
  },
  {
    key: 'missing-student', name: 'Brak ucznia podczas zajęć', category: 'Opieka nad uczniami',
    steps: [
      'Sprawdź listę obecności oraz dostępne informacje o usprawiedliwionej nieobecności lub zmianie sali.',
      'Niezwłocznie poinformuj dyrekcję lub osobę wyznaczoną w procedurze szkoły.',
      'Zachowaj opiekę nad pozostałą grupą; uzgodnij z koordynatorem podział zadań.',
      'Przekaż znane fakty: ostatnie potwierdzone miejsce pobytu, czas i okoliczności.',
      'Dalsze działania i kontakt z opiekunami realizuj według zatwierdzonej procedury placówki.',
      'Odnotuj przebieg zdarzenia i przekaż koordynatorowi informację o jego zakończeniu.'
    ]
  },
  {
    key: 'infrastructure', name: 'Awaria infrastruktury', category: 'Organizacja',
    steps: [
      'Zgłoś miejsce i zaobserwowany rodzaj awarii sekretariatowi lub wyznaczonemu pracownikowi.',
      'Zadbaj, by uczniowie pozostali pod opieką i nie zbliżali się do miejsca awarii.',
      'Nie podejmuj napraw instalacji bez odpowiednich uprawnień.',
      'Uzgodnij z dyrekcją zmianę miejsca lub organizacji zajęć.',
      'Przekaż grupie zatwierdzony komunikat i oczekuj na potwierdzenie możliwości dalszego użytkowania pomieszczeń.'
    ]
  },
  {
    key: 'peer-violence', name: 'Zgłoszenie przemocy rówieśniczej', category: 'Wsparcie ucznia',
    steps: [
      'Przyjmij zgłoszenie spokojnie i zadbaj o bezpieczne warunki rozmowy.',
      'Zadbaj o bieżącą opiekę nad uczniem zgodnie z zasadami ochrony przyjętymi w szkole.',
      'Przekaż zgłoszenie osobie odpowiedzialnej: dyrekcji, pedagogowi lub koordynatorowi.',
      'Zapisz fakty i treść zgłoszenia, oddzielając je od własnych przypuszczeń.',
      'Uzgodnij dalsze działania i kontakt z opiekunami zgodnie z procedurą placówki.',
      'Sprawdź z osobą koordynującą, czy uczeń otrzymał ustalone wsparcie.'
    ]
  },
  {
    key: 'communication', name: 'Komunikat organizacyjny', category: 'Informacja',
    steps: [
      'Zapoznaj się z komunikatem i sprawdź, jakiej grupy oraz terminu dotyczy.',
      'W razie niejasności potwierdź treść z sekretariatem lub autorem komunikatu.',
      'Przekaż zatwierdzoną informację osobom, których dotyczy, ustalonym kanałem szkolnym.',
      'Zastosuj uzgodnione zmiany i zgłoś koordynatorowi przeszkody w ich realizacji.'
    ]
  }
];

export function addProcedureTemplates(data, schoolId) {
  data.procedureTemplatesApplied ??= [];
  if (data.procedureTemplatesApplied.includes(schoolId)) return 0;
  let added = 0;
  for (const template of procedureTemplates) {
    if (data.procedures.some(p => p.schoolId === schoolId && p.name.trim().toLocaleLowerCase('pl') === template.name.toLocaleLowerCase('pl'))) continue;
    data.procedures.push({ id: randomUUID(), schoolId, name: template.name, category: template.category, description, steps: [...template.steps] });
    added++;
  }
  data.procedureTemplatesApplied.push(schoolId);
  return added;
}
