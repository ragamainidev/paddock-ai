import { createClient, type Client } from '@libsql/client';

// Independently authored synthetic query-contract fixture. These are test
// scenarios, not a sourced vehicle catalog, production history, or fitment
// evidence. Explicit positive/negative rows exercise rich nullable columns;
// no production knowledge table, source CSV, or expected result generates it.
export async function createRichCatalogFixture(): Promise<Client> {
  const db = createClient({ url: ':memory:' });
  await db.execute(`CREATE TABLE vehicles (
    id INTEGER PRIMARY KEY, make TEXT NOT NULL, model TEXT NOT NULL, year INTEGER NOT NULL,
    engine TEXT, submodel TEXT, trim TEXT, body TEXT, drive TEXT, block_type TEXT,
    cylinders INTEGER, displacement REAL, aspiration TEXT, fuel TEXT, doors INTEGER
  )`);
  await db.execute(`INSERT INTO vehicles
    (make,model,year,trim,submodel,body,block_type,cylinders,aspiration,fuel) VALUES
    ('BMW','M3',1999,'Base','Base','Coupe','L',6,'NA','GAS'),
    ('BMW','M3',2001,'Base','Base','Coupe','L',6,'NA','GAS'),
    ('BMW','M3',2002,'Base','Base','Coupe','L',6,'NA','GAS'),
    ('BMW','M3',2003,'Base','Base','Coupe','L',6,'NA','GAS'),
    ('BMW','M3',2004,'Base','Base','Coupe','L',6,'NA','GAS'),
    ('BMW','M3',2005,'Base','Base','Coupe','L',6,'NA','GAS'),
    ('BMW','M3',2006,'Base','Base','Coupe','L',6,'NA','GAS'),
    ('BMW','330i',2004,'Base','Base','Sedan','L',6,'NA','GAS'),
    ('BMW','330i',2012,'Base','Base','Sedan','L',6,'NA','GAS'),
    ('BMW','M5',2008,'Base','Base','Sedan','V',10,'NA','GAS'),
    ('Audi','A6',2016,'Base','Base','Sedan','V',6,'Turbo','GAS'),
    ('Chevrolet','Corvette',2016,'Base','Base','Coupe','V',8,'NA','GAS'),
    ('Audi','R8',2011,'Base','Base','Coupe','V',10,'NA','GAS'),
    ('Porsche','911',2018,'GT3 RS','Base','Coupe','H',6,'NA','GAS'),
    ('Porsche','911',2019,'GT3 RS','Base','Coupe','H',6,'NA','GAS'),
    ('Porsche','911',2023,'GT3 RS','Base','Coupe','H',6,'NA','GAS'),
    ('Porsche','911',2024,'GT3 RS','Base','Coupe','H',6,'NA','GAS'),
    ('Porsche','911',2022,'GT3 Touring','Base','Coupe','H',6,'NA','GAS'),
    ('Porsche','911',2021,'GT3','Base','Coupe','H',6,'NA','GAS'),
    ('Porsche','911',2001,'Carrera','Base','Coupe','H',6,'NA','GAS'),
    ('Porsche','911',2002,'Turbo','Base','Coupe','H',6,'Turbo','GAS'),
    ('Porsche','911',2003,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
    ('Volkswagen','Golf',2014,'Base','Base','Wagon','L',4,'Turbo','DIESEL'),
    ('Chevrolet','Corvette',1992,'ZR-1','Base','Coupe','V',8,'NA','GAS'),
    ('Chevrolet','Corvette',2010,'ZR1','Base','Coupe','V',8,'Supercharged','GAS'),
    ('Chevrolet','Corvette',2003,'Z06','Base','Coupe','V',8,'NA','GAS'),
    ('Chevrolet','Corvette',2003,'Base','Base','Coupe','V',8,'NA','GAS'),
    ('Mazda','Miata',2000,NULL,NULL,'Convertible','L',4,'NA','GAS'),
    ('Toyota','Supra',1995,'Base','Base','Coupe','L',6,'NA','GAS'),
    ('Toyota','Supra',1990,'Base','Base','Coupe','L',6,'NA','GAS'),
    ('Lexus','SC300',1994,'Base','Base','Coupe','L',6,'NA','GAS'),
    ('Lexus','IS300',2002,'Base','Base','Sedan','L',6,'NA','GAS'),
    ('Lexus','IS300',2008,'Base','Base','Sedan','L',6,'NA','GAS')`);
  return db;
}
