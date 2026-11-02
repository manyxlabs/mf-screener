type Source = { rule: string; links: { label: string; href: string }[] };

const BILL_2018 = {
  label: "Finance Bill 2018",
  href: "https://www.indiabudget.gov.in/budget2018-2019/ub2018-19/fb/bill.pdf",
};
const BILL_2024 = {
  label: "Finance (No. 2) Bill 2024",
  href: "https://www.indiabudget.gov.in/budget2024-25/doc/Finance_Bill.pdf",
};
const MEMO_2024 = {
  label: "Memorandum to the Finance (No. 2) Bill 2024",
  href: "https://www.indiabudget.gov.in/budget2024-25/doc/memo.pdf",
};
const FAQ_2024 = {
  label: "CBDT FAQs on the 2024 capital gains changes",
  href: "https://pib.gov.in/PressReleasePage.aspx?PRID=2036604",
};
const ACT_2025 = {
  label: "Income-tax Act 2025 (sections 2(101), 76, 90, 108, 196-198)",
  href: "https://egazette.gov.in/WriteReadData/2025/265620.pdf",
};

export const SOURCES: Source[] = [
  {
    rule: "Holding period: equity-oriented fund units are long-term when held more than 12 months. Other units needed more than 36 months for sales before 23 Jul 2024; from that date listed units, ETFs included, need 12 and the rest 24. Units bought on 1 Jan complete 12 months on 31 Dec, so a sale on 1 Jan of the next year is long-term. Some statements count by days instead, which can differ by a day.",
    links: [
      BILL_2024,
      FAQ_2024,
      {
        label: "Delhi High Court, Bharti Gupta Ramola v. CIT (2012)",
        href: "https://delhihighcourt.nic.in/app/downloadOrderbByDate/ITA/1234/2011/12-04-2012",
      },
    ],
  },
  {
    rule: "Section 111A: short-term gains on equity-oriented fund units at 15%, and 20% for sales from 23 Jul 2024.",
    links: [BILL_2024, MEMO_2024],
  },
  {
    rule: "Section 112A: long-term gains on equity-oriented fund units at 10%, and 12.5% for sales from 23 Jul 2024, above an exemption of Rs 1 lakh a year, Rs 1.25 lakh from FY 2024-25. In FY 2024-25 the Rs 1.25 lakh is one limit across both rates; the law does not say which gains it covers first, so it is applied to the 12.5% gains, the cheaper choice. It taxes sales from 1 Apr 2018; before that, section 10(38) exempted them, so earlier years are listed without tax.",
    links: [BILL_2018, BILL_2024, FAQ_2024],
  },
  {
    rule: "Grandfathering: for equity-oriented units bought before 1 Feb 2018, the cost is the higher of the actual cost and the lower of the value on 31 Jan 2018 and the sale value. That value is the NAV on 31 Jan 2018, or for a listed unit the highest price it traded at that day.",
    links: [BILL_2018],
  },
  {
    rule: "Section 112: long-term gains on other units at 20% with indexation for sales before 23 Jul 2024 (cost inflation index, base 2001-02 = 100), and 12.5% without indexation from that date. Short-term gains on these units are taxed at the slab rate.",
    links: [
      BILL_2024,
      MEMO_2024,
      { label: "Cost inflation index", href: "https://incometaxindia.gov.in/w/view-all-cii" },
    ],
  },
  {
    rule: "Section 50AA (Finance Act 2023): gains on units of a specified mutual fund bought on or after 1 Apr 2023 are short-term however long they are held, at the slab rate. Up to FY 2024-25 a specified fund was one with no more than 35% in Indian equity, which caught gold, silver and international funds. The Finance (No. 2) Act 2024 narrowed it from FY 2025-26 to funds with more than 65% in debt and money market instruments, or 65% or more in such funds.",
    links: [BILL_2024, MEMO_2024],
  },
  {
    rule: "Equity-oriented fund: at least 65% of its money in listed Indian equity, or a fund of funds with 90% in a listed fund that itself holds 90% in listed Indian equity. The fund type here comes from the SEBI category where that settles it; check your fund's own treatment.",
    links: [BILL_2018],
  },
  {
    rule: "Set-off: a short-term loss can reduce any capital gain, a long-term loss only a long-term gain (sections 70 and 74). The law sets no order across rates, so losses are set against the highest rate first. Losses carried forward from earlier years are not included.",
    links: [ACT_2025],
  },
  {
    rule: "Health and education cess of 4% on the tax. Surcharge, which on these gains is capped at 15%, is not included.",
    links: [BILL_2018],
  },
  {
    rule: "From 1 Apr 2026 the Income-tax Act 2025 replaces the 1961 Act with the same rules under new numbers: 111A is section 196, 112 is 197, 112A is 198 and 50AA is 76.",
    links: [ACT_2025],
  },
];
