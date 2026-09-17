import { Controller, Get } from '@nestjs/common';
import { REGIONS } from '@somex/shared';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';

/** Public reference data: banks, regions, rates. */
@Controller('catalog')
export class CatalogController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('banks')
  async banks() {
    const banks = await this.prisma.bank.findMany({ where: { enabled: true }, orderBy: { order: 'asc' } });
    return banks.map((b) => ({ ...b, deepLink: undefined }));
  }

  @Public()
  @Get('regions')
  regions() {
    return REGIONS;
  }

  @Public()
  @Get('rates')
  async rates() {
    const rates = await this.prisma.rate.findMany();
    return rates.map((r) => ({ asset: r.asset, fiat: r.fiat, price: r.price.toString(), source: r.source, updatedAt: r.updatedAt }));
  }
}
