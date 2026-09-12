// Selection is independent of the private catalog and the interpretation tables.
// Keep complete EPA model families, plus a stable 1% sample of other source IDs.
// EPA's model spelling (including configurations) is preserved in the output.
const ENTHUSIAST: Record<string, RegExp> = {
  Porsche: /^(911|718|Boxster|Cayman|944|928|Carrera GT)/i,
  BMW: /^(M[234568]|1 Series M|Z[348]|M240|M340|135|128|3[12345][035]|5[2345][058])/i,
  Chevrolet: /^(Corvette|Camaro)/i,
  Toyota: /^(Supra|GR Supra|GR86|86|Celica|MR2|Corolla)/i,
  Volkswagen: /^(GTI|Golf|Jetta|R32|Rabbit|Corrado)/i,
  Honda: /^(Civic|CRX|S2000|Prelude)/i,
  Acura: /^(Integra|NSX|RSX)/i,
  Mazda: /^(MX-5|Miata|RX-7|RX-8)/i,
  Nissan: /^(GT-R|300ZX|350Z|370Z|Z($| )|240SX)/i,
  Subaru: /^(WRX|Impreza|BRZ|Legacy|Outback)/i,
  Mitsubishi: /^(Lancer|Eclipse|3000GT)/i,
  Eagle: /^Talon/i,
  Audi: /^(A[3467]|S[34567]|RS ?[34567]|TT|R8)/i,
  'Mercedes-Benz': /^(190|300|C36|C43|C63|E55|E63|AMG GT|E320|E300|SL500|SL55)/i,
  Dodge: /^(Challenger|Charger|Viper|Neon)/i,
  Ford: /^(Mustang|F150|F-150|Focus|Fiesta|GT($| ))/i,
  'Alfa Romeo': /^(Giulia|4C|Stelvio)/i,
  Lexus: /^(LFA|IS F|RC F|GS F|IS 300|IS300|SC 300|SC300|SC400)/i,
  Lamborghini: /^(Gallardo|Huracan)/i,
  Infiniti: /^(G35|G37|FX35)/i,
  Volvo: /^(850|V70|240|V60)/i,
  Kia: /^Stinger/i,
};

export function isEnthusiastModel(make: string, model: string): boolean {
  return ENTHUSIAST[make]?.test(model) ?? false;
}

export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function inSubset(row: { id: string; make: string; model: string }): boolean {
  return isEnthusiastModel(row.make, row.model) || fnv1a(row.id) % 100 === 0;
}
