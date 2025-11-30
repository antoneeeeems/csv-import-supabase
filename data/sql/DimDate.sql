-- Create the DimDate table
CREATE TABLE DimDate (
    DateKey INT PRIMARY KEY,
    FullDate DATE NOT NULL,
    DayOfMonth INT NOT NULL,
    DayName VARCHAR(10) NOT NULL,
    DayOfWeek INT NOT NULL,
    Month INT NOT NULL,
    MonthName VARCHAR(10) NOT NULL,
    Quarter INT NOT NULL,
    Year INT NOT NULL
);

-- Use a recursive Common Table Expression (CTE) to generate dates
-- Starting from January 1, 2023
DECLARE @StartDate DATE = '2023-01-01';
-- Ending on December 31, 2024
DECLARE @EndDate DATE = '2024-12-31';

WITH DateSeries AS (
    SELECT @StartDate AS MyDate
    UNION ALL
    SELECT DATEADD(day, 1, MyDate)
    FROM DateSeries
    WHERE MyDate < @EndDate
)

-- Insert the generated dates into the DimDate table
INSERT INTO DimDate (
    DateKey,
    FullDate,
    DayOfMonth,
    DayName,
    DayOfWeek,
    Month,
    MonthName,
    Quarter,
    Year
)
SELECT
    CONVERT(INT, FORMAT(MyDate, 'yyyyMMdd')) AS DateKey,
    MyDate AS FullDate,
    DAY(MyDate) AS DayOfMonth,
    DATENAME(weekday, MyDate) AS DayName,
    DATEPART(weekday, MyDate) AS DayOfWeek,
    MONTH(MyDate) AS Month,
    DATENAME(month, MyDate) AS MonthName,
    DATEPART(quarter, MyDate) AS Quarter,
    YEAR(MyDate) AS Year
FROM DateSeries
OPTION (MAXRECURSION 32767); -- Set max recursion to a high value for the query